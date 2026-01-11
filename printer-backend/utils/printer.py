from typing import List
import os
import serial  # type: ignore[import-not-found]
import time
import threading
from enum import Enum

from utils.braille_to_gcode import DotPosition, GcodeAction, dot_pos_to_gcode

# Replace with your printer's correct port
port = "/dev/tty.usbserial-0001"
baud_rate = 250000  # Adjust this to match your printer's baud rate

DEBUG = False

class StopRequested(Exception):
    """Raised internally to abort blocking waits when a stop is requested."""
    pass

class PrintStatus(Enum):
    IDLE = "idle"
    PRINTING = "printing" 
    PAUSED = "paused"
    COMPLETED = "completed"
    ERROR = "error"

def calculate_checksum(command):
    """Calculate Marlin-style checksum for a G-code command."""
    checksum = 0
    # Include the space after the command in checksum calculation
    for c in command:
        checksum ^= ord(c)
    return checksum & 0xFF  # Ensure 8-bit result

class PrinterConnection:
    def __init__(self, port, baud_rate):
        self.port = port
        self.baud_rate = baud_rate
        self.ser = None
        self.line_number = 0
        self.E_steps_per_unit = 400.0
        self.E_steps_per_degree = 8 * 0.9
        self.status = PrintStatus.IDLE
        self.print_thread = None
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        # Protocol mode:
        # - "plain": send normal G-code lines (e.g. "M115\n") and wait for "ok"
        # - "checksum": send Marlin-style N-line + checksum (legacy behavior)
        # Default to plain because it matches our standalone connect test and is
        # accepted by most printer firmwares.
        self.protocol = "plain"

    def _maybe_map_tty_to_cu(self, port: str) -> str:
        """
        macOS: prefer /dev/cu.* over /dev/tty.* when available.
        Many drivers behave better with the callout device, and /dev/tty.* can raise EINVAL.
        """
        try:
            if isinstance(port, str) and port.startswith("/dev/tty."):
                cu = "/dev/cu." + port[len("/dev/tty.") :]
                if os.path.exists(cu):
                    return cu
        except Exception:
            pass
        return port

    def _write_line_plain(self, line: str):
        if not self.ser or not self.ser.is_open:
            raise serial.PortNotOpenError()
        payload = (line.strip() + "\n").encode("ascii", errors="replace")
        self.ser.write(payload)
        if DEBUG:
            print(f"Sent (plain): {line.strip()}")

    def connect(self):
        """
        Establish a serial connection (no handshake).

        This is intentionally minimal so the HTTP `/connect` request returns quickly and the
        UI can reflect connection state. Any firmware-level probing/handshake should be done
        later (or not at all), depending on the device.
        """
        print("Connecting to printer...")

        # macOS: prefer /dev/cu.* when possible
        self.port = self._maybe_map_tty_to_cu(self.port)

        # Close any previous handle defensively
        try:
            if self.ser is not None and getattr(self.ser, "is_open", False):
                self.ser.close()
        except Exception:
            pass
        self.ser = None

        # Open in the simplest way possible.
        # (We still explicitly disable flow control to avoid platform/driver surprises.)
        ser = serial.Serial()
        ser.port = self.port
        ser.baudrate = self.baud_rate
        ser.timeout = 0.5
        ser.rtscts = False
        ser.dsrdtr = False
        ser.xonxoff = False
        ser.open()
        self.ser = ser

        self.status = PrintStatus.IDLE
        self.protocol = "plain"
        self.line_number = 0
        
        print(f"Connected. protocol={self.protocol}, port={self.port}, baud={self.baud_rate}")

    def _debug_print_rx(self, b: bytes):
        if not b:
            return
        try:
            txt = b.decode("utf-8", errors="replace").rstrip()
        except Exception:
            txt = "<decode failed>"
        if DEBUG:
            print(f"Printer(raw): {txt} [hex: {b.hex(' ')}]")
        else:
            # Keep user-visible output readable (no hex spam).
            if txt:
                print(f"Printer: {txt}")

    def _read_lines_for(self, seconds: float) -> list[bytes]:
        if not self.ser or not self.ser.is_open:
            return []
        end = time.time() + seconds
        out: list[bytes] = []
        while time.time() < end:
            try:
                line = self.ser.readline()
            except Exception:
                break
            if not line:
                continue
            out.append(line)
        return out

    def _probe_plain_protocol(self) -> bool:
        """
        Try sending a plain G-code command and look for an 'ok' / firmware info response.
        Returns True if it looks like the firmware is responding to plain commands.
        """
        try:
            self._write_line_plain("M115")
            responses = self._read_lines_for(seconds=2)
            for b in responses:
                # Print what we got for debugging / visibility
                self._debug_print_rx(b)
                try:
                    txt = b.decode("utf-8", errors="ignore").lower()
                except Exception:
                    txt = ""
                if "ok" in txt or "firmware_name" in txt or "marlin" in txt:
                    return True
            return False
        except Exception:
            return False

    def initialize(self):
        self.send_command("G91")     # Set relative positioning
        self.send_command("G1 Z10 F800")
        self.send_command("G90")     # Set absolute positioning
        self.send_command("M83")     # Set relative extrusion
        self.send_command("M302 S0") # Allow cold extrusion at any temperature
        self.send_command("G28")     # Zero all axes
        # Calibrate extrusion
        # for _ in range(2):
        #     self.send_command("G1 E2.2 F200")
        #     self.send_command("G1 E-2.2 F200")
        # self.send_command("G1 E2.2 F200")
        # self.send_command("G1 Z3 F800")
        self.send_command("G1 Z-2 F800")
        # input("Press Enter to continue...")

    def cleanup(self, *, best_effort: bool = False, include_home_xy: bool = True):
        """
        Post-print cleanup motions.

        IMPORTANT: If `best_effort=True`, we will not block waiting for OKs (and can skip homing),
        so stop/cancel paths never hang the HTTP request.
        """
        if self.ser and self.ser.is_open:
            self.send_command("G1 Z10 F800", wait_for_ok=not best_effort)  # Move z axis up
            if include_home_xy:
                self.send_command("G28 X0 Y0", wait_for_ok=not best_effort)  # Home X/Y
            self.send_command("G1 Z10 F800", wait_for_ok=not best_effort)  # Lift to remove page

    def wait_for_start(self, timeout=10):
        """Wait for the printer to send 'start' after connecting."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            if self.ser.in_waiting:
                response = self.ser.readline()
                self._debug_print_rx(response)
                try:
                    txt = response.decode("utf-8", errors="ignore").strip()
                except Exception:
                    txt = ""
                if "start" in txt.lower():
                    return True
        return False

    def send_command(self, command, wait_for_ok=True):
        """Send a G-code command with line number and checksum."""
        if not self.ser or not self.ser.is_open:
            raise serial.PortNotOpenError()
            
        if self.protocol == "plain":
            self._write_line_plain(command)
            if not wait_for_ok:
                return True
            # Wait for an "ok" (or timeout loops until readline returns empty)
            start = time.time()
            while time.time() - start < 25:
                if self._stop_event.is_set():
                    # Abort blocking waits immediately when a stop is requested.
                    raise StopRequested("Stop requested")
                resp_b = self.ser.readline()
                if not resp_b:
                    continue
                self._debug_print_rx(resp_b)
                try:
                    resp = resp_b.decode("utf-8", errors="ignore").strip()
                except Exception:
                    resp = ""
                if not resp:
                    continue
                low = resp.lower()
                if "ok" in low:
                    return True
                if low.startswith("error") or "error:" in low:
                    raise Exception(resp)
            raise Exception(f"Timeout waiting for OK (plain protocol) after command: {command}")
            
        # Legacy checksum mode (keep, but add hard timeouts to avoid hanging /connect).
        start_overall = time.time()
        while True:  # Keep trying until command is accepted
            if time.time() - start_overall > 25:
                raise Exception(f"Timeout waiting for OK (checksum protocol) after command: {command}")
            if command.startswith('N'):
                formatted_command = command
            else:
                formatted_command = f"N{self.line_number} {command}"
            
            # Add checksum if not already present
            if '*' not in formatted_command:
                # Calculate checksum only for the part before any existing *
                checksum_part = formatted_command.split('*')[0]
                checksum = calculate_checksum(checksum_part)
                formatted_command = f"{checksum_part}*{checksum}"  # Removed extra space before *
                print(f"Debug - Command: '{checksum_part}', Checksum: {checksum}")  # Debug line

            self.ser.write((formatted_command + "\n").encode("ascii", errors="replace"))
            print(f"Sent: {formatted_command}")

            if not wait_for_ok:
                break

            # Wait for response
            start_wait = time.time()
            while True:
                if time.time() - start_wait > 5:
                    # Give the outer loop a chance to resend; also prevents infinite inner loops.
                    break
                response_b = self.ser.readline()
                if not response_b:
                    continue
                try:
                    response = response_b.decode("utf-8", errors="replace").strip()
                except Exception:
                    response = ""
                if not response:
                    continue
                
                print(f"Printer: {response}")
                
                # Check for resend requests
                if "resend:" in response.lower():
                    self.line_number = int(response.lower().split("resend:")[1].strip())
                    break
                elif "error:checksum mismatch" in response.lower():
                    # Extract last line number and set our counter to next line
                    try:
                        last_line = int(response.lower().split("last line:")[1].strip())
                        self.line_number = last_line + 1
                    except (ValueError, IndexError):
                        self.line_number = 1  # Reset to 1 if we can't parse the line number
                    break
                elif "error:line number is not" in response.lower():
                    # Similar handling as checksum mismatch
                    try:
                        last_line = int(response.lower().split("last line:")[1].strip())
                        self.line_number = last_line + 1
                    except (ValueError, IndexError):
                        self.line_number = 1
                    break
                elif "echo:  m92 " in response.lower():
                    gcode = response.replace("echo:  m92 ", "").strip()
                    parts = gcode.split(" ")
                    for part in parts:
                        if part.startswith("E"):
                            self.E_steps_per_unit = float(part.replace("E", ""))
                            print(f"E_steps_per_unit: {self.E_steps_per_unit}")
                            break
                
                if "ok" in response.lower():
                    self.line_number += 1  # Only increment after confirmed OK
                    return True
                
                # If we get here, keep reading responses until we get ok/error
                continue
            
            # If we broke out of the inner while loop, it means we need to resend
            continue

    def close(self):
        """Close the printer connection."""
        if self.ser and getattr(self.ser, "is_open", False):
            try:
                self.ser.close()
            except OSError:
                # Can happen during interpreter shutdown / interrupted runs.
                pass
            except Exception:
                pass
            finally:
                self.ser = None
            print("Connection closed.")

    def stop(self):
        """Stop the current print job."""
        # Signal the print thread / any blocking send_command() calls to abort.
        self._stop_event.set()
        # Try to un-pause so the thread can actually exit.
        self._pause_event.clear()

        # Best-effort firmware stop commands (non-blocking).
        # These are Marlin-ish; safe to ignore failures / unsupported commands.
        try:
            if self.ser and self.ser.is_open:
                try:
                    self.send_command("M410", wait_for_ok=False)  # Quickstop
                except Exception:
                    pass
                try:
                    self.send_command("M0", wait_for_ok=False)    # Stop
                except Exception:
                    pass
        except Exception:
            pass

        # Do not block the HTTP request waiting for the thread to finish.
        if self.print_thread:
            try:
                self.print_thread.join(timeout=1.0)
            except Exception:
                pass

        self.status = PrintStatus.IDLE
        # Do NOT run cleanup/homing on stop; it can hang mid-print.

    def pause(self):
        """Pause the current print job."""
        if self.status == PrintStatus.PRINTING:
            self._pause_event.set()
            self.status = PrintStatus.PAUSED

    def resume(self):
        """Resume the paused print job."""
        if self.status == PrintStatus.PAUSED:
            self._pause_event.clear()
            self.status = PrintStatus.PRINTING

    def get_status(self):
        """Get the current status of the printer."""
        return self.status


def print_gcode(gcode_actions: List[GcodeAction], printer: PrinterConnection):
    def print_thread():
        try:
            # Starting a fresh print cancels any previous stop request.
            printer._stop_event.clear()
            printer.initialize()
            printer.status = PrintStatus.PRINTING
            
            for action in gcode_actions:
                if printer._stop_event.is_set():
                    break
                    
                while printer._pause_event.is_set():
                    time.sleep(0.1)
                    if printer._stop_event.is_set():
                        break
                        
                printer.send_command(action.command)
                action.callback()
                
            if not printer._stop_event.is_set():
                printer.cleanup()
                printer.status = PrintStatus.COMPLETED
                
        except StopRequested:
            # Expected path when user hits Stop mid-print.
            printer.status = PrintStatus.IDLE
        except serial.SerialException as e:
            print(f"Serial error: {e}")
            printer.status = PrintStatus.ERROR
        except Exception as e:
            print(f"Error: {e}")
            printer.status = PrintStatus.ERROR

    if DEBUG:
        print("DEBUG: starting print thread")
    printer.print_thread = threading.Thread(target=print_thread)
    printer.print_thread.start()
    if DEBUG:
        print("DEBUG: print thread started")
    return printer  # Return printer object so caller can control/monitor the print

def stop_print(printer: PrinterConnection):
    if DEBUG:
        print("DEBUG: stopping print")
    printer.stop()
    if DEBUG:
        print("DEBUG: print stopped")

def pause_print(printer: PrinterConnection):
    if DEBUG:
        print("DEBUG: pausing print")
    printer.pause()
    if DEBUG:
        print("DEBUG: print paused")

def resume_print(printer: PrinterConnection):
    if DEBUG:
        print("DEBUG: resuming print")
    printer.resume()
    if DEBUG:
        print("DEBUG: print resumed")

def print_dots(dots: List[DotPosition], printer: PrinterConnection):
    gcode_actions = dot_pos_to_gcode(dots)
    return print_gcode(gcode_actions, printer)

def main():
    printer = PrinterConnection(port, baud_rate)
    try:
        printer.connect()
        printer.initialize()

        # Example movement commands
        printer.send_command("G1 E2 F800")
        printer.send_command("G1 X10 Y10 Z10 F400")
        printer.send_command("G1 E2 F800")
        printer.send_command("G1 X10 Y10 Z10 F400")
        printer.send_command("G1 E2 F800")

    except serial.SerialException as e:
        print(f"Serial error: {e}")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        printer.close()

if __name__ == "__main__":
    main()


