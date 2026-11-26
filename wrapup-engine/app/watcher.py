"""
"הסוכן" שרץ על השרת של העסק: עוקב אחרי תיקיית ההקלטות של המרכזייה.
כל קובץ חדש → מעובד אוטומטית (pipeline) → מועבר ל-processed/ או ל-failed/.

הגדרה ב-.env:
  RECORDINGS_DIR=/path/to/pbx/recordings   (ברירת מחדל: תיקיית recordings בפרויקט)
"""
import logging
import os
import shutil
import threading
import time
from pathlib import Path

from pipeline import process_file
from transcribe import AUDIO_EXTENSIONS, TEXT_EXTENSIONS

log = logging.getLogger("watcher")
ROOT = Path(__file__).resolve().parent.parent
POLL_SECONDS = 3


def recordings_dir() -> Path:
    return Path(os.getenv("RECORDINGS_DIR", ROOT / "recordings")).expanduser()


def _move(path: Path, folder: str) -> Path:
    target_dir = path.parent / folder
    target_dir.mkdir(exist_ok=True)
    target = target_dir / path.name
    if target.exists():
        target = target_dir / f"{path.stem}_{int(time.time())}{path.suffix}"
    shutil.move(str(path), target)
    return target


def _loop() -> None:
    folder = recordings_dir()
    folder.mkdir(parents=True, exist_ok=True)
    log.info("עוקב אחרי %s", folder)
    sizes: dict[Path, int] = {}
    while True:
        try:
            for path in sorted(folder.iterdir()):
                if not path.is_file() or path.name.startswith("."):
                    continue
                if path.suffix.lower() not in AUDIO_EXTENSIONS | TEXT_EXTENSIONS:
                    continue
                # מחכים שהקובץ יסיים להיכתב: אותו גודל בשתי בדיקות רצופות
                size = path.stat().st_size
                if sizes.get(path) != size or size == 0:
                    sizes[path] = size
                    continue
                sizes.pop(path, None)
                try:
                    process_file(path, source="folder")
                    _move(path, "processed")
                except Exception as e:  # noqa: BLE001
                    log.warning("נכשל: %s - %s", path.name, e)
                    failed = _move(path, "failed")
                    failed.with_suffix(failed.suffix + ".error.txt").write_text(str(e), encoding="utf-8")
        except Exception:  # noqa: BLE001
            log.exception("שגיאה במעקב התיקייה")
        time.sleep(POLL_SECONDS)


def start() -> None:
    threading.Thread(target=_loop, daemon=True, name="recordings-watcher").start()
