# Dead Ends & Investigation Notes

Read before starting a session. Append when stuck after 10+ tool calls with no progress.

Lifecycle: **Active** -> **Resolved** (prefix with RESOLVED + date once understood) -> delete after 20+ sessions.

## Entry format

## <Subsystem or Function Name>
- **Tried**: what approach was attempted
- **Failed because**: root cause of failure
- **Better approach**: what to do instead
- **Session**: NNN

## Comparing bank 0 with Mario Tennis byte for byte
- **Tried**: the HANDOFF plan compares Golf's bank 0 with Tennis's bank 0 bytes.
- **Failed because**: the Tennis ROM is not in the repository (only its tools and notes are), so there are no
  Tennis bytes to compare in a fresh checkout.
- **Better approach**: `tools/compare_home.py` reads Tennis's bank 0 from the vendored disassembly source (every
  instruction carries its address) and compares instruction shapes instead. Works without the Tennis ROM.
- **Session**: 001
