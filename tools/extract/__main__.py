import signal
import sys

from .cli import main


def _exit_on_signal(signum, frame):
    # turn SIGTERM/SIGHUP into SystemExit so `finally` blocks (remote temp cleanup) still run
    raise SystemExit(128 + signum)


if __name__ == "__main__":
    for sig in (signal.SIGTERM, getattr(signal, "SIGHUP", None)):
        if sig is not None:
            signal.signal(sig, _exit_on_signal)
    sys.exit(main())
