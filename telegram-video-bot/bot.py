"""Telegram 影片下載機器人：丟網址進來，回傳 MP4 和 MP3。

支援 yt-dlp 能抓的網站（YouTube、X/Twitter、Instagram、Facebook、TikTok…）。
Token 從環境變數 TELEGRAM_BOT_TOKEN 讀，絕對不要寫死在程式裡。
"""

import asyncio
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import yt_dlp
from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("video-bot")

# Bot API 一般上傳上限是 50 MB；留一點餘裕。
MAX_UPLOAD = 49 * 1024 * 1024
URL_RE = re.compile(r"https?://\S+")
# 選填：只允許這些 Telegram user id 使用（逗號分隔），沒設就誰都能用。
ALLOWED_USERS = {int(x) for x in os.getenv("ALLOWED_USER_IDS", "").replace(" ", "").split(",") if x}
# 選填：Netscape 格式 cookies 檔，Instagram / 需登入的影片會用到。
COOKIES_FILE = os.getenv("YTDLP_COOKIES")
# 同時最多處理幾個下載，避免機器被塞爆。
DOWNLOAD_SLOTS = asyncio.Semaphore(int(os.getenv("MAX_PARALLEL", "2")))


def _base_opts(workdir: Path) -> dict:
    opts = {
        "outtmpl": str(workdir / "%(title).80B [%(id)s].%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": False,
    }
    if COOKIES_FILE:
        opts["cookiefile"] = COOKIES_FILE
    return opts


def download_video(url: str, workdir: Path) -> tuple[Path, dict]:
    """下載最佳畫質（最高 1080p）並合併成 MP4。"""
    opts = _base_opts(workdir) | {
        "format": "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
        "merge_output_format": "mp4",
        # 不是 mp4 的（例如 webm）轉成 mp4，確保手機能直接播。
        "postprocessors": [{"key": "FFmpegVideoConvertor", "preferedformat": "mp4"}],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    files = sorted(workdir.glob("*.mp4"), key=lambda p: p.stat().st_size, reverse=True)
    if not files:
        raise RuntimeError("下載完成但找不到 MP4 檔")
    return files[0], info


def shrink_video(src: Path, duration: float | None) -> Path | None:
    """影片超過 50 MB 時，用 ffmpeg 依片長算位元率重新壓縮。壓不下去回傳 None。"""
    if not duration:
        return None
    audio_kbps = 96
    # 目標 46 MB，換算整體位元率再扣掉音訊。
    total_kbps = (46 * 8 * 1024) / duration
    video_kbps = int(total_kbps - audio_kbps)
    if video_kbps < 150:  # 片太長，壓到這麼低就沒法看了
        return None
    dst = src.with_name(src.stem + ".small.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
         "-vf", "scale='min(854,iw)':-2", "-c:v", "libx264", "-preset", "veryfast",
         "-b:v", f"{video_kbps}k", "-maxrate", f"{video_kbps}k", "-bufsize", f"{video_kbps * 2}k",
         "-c:a", "aac", "-b:a", f"{audio_kbps}k", "-movflags", "+faststart", str(dst)],
        check=True,
    )
    return dst if dst.stat().st_size <= MAX_UPLOAD else None


def extract_mp3(video: Path, duration: float | None) -> Path:
    """從 MP4 抽出 MP3；片太長時降低位元率以壓在 50 MB 內。"""
    kbps = 192
    if duration:
        kbps = max(48, min(192, int((46 * 8 * 1024) / duration)))
    dst = video.with_suffix(".mp3")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
         "-vn", "-c:a", "libmp3lame", "-b:a", f"{kbps}k", str(dst)],
        check=True,
    )
    return dst


def human(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} MB"


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "把影片網址丟給我（YouTube、X、Instagram、Facebook、TikTok…），"
        "我會回傳 MP4 影片和 MP3 音訊。\n\n"
        "限制：Telegram 機器人單檔最多 50 MB，太大的影片會自動壓縮畫質。"
    )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    msg = update.message
    if ALLOWED_USERS and update.effective_user.id not in ALLOWED_USERS:
        await msg.reply_text("你沒有使用權限。")
        return

    match = URL_RE.search(msg.text or "")
    if not match:
        await msg.reply_text("請傳一個影片網址給我 🙂")
        return
    url = match.group(0)

    status = await msg.reply_text("⏳ 排隊中…")
    async with DOWNLOAD_SLOTS:
        workdir = Path(tempfile.mkdtemp(prefix="vbot-"))
        try:
            await status.edit_text("⬇️ 下載中…")
            await context.bot.send_chat_action(msg.chat_id, ChatAction.UPLOAD_VIDEO)
            video, info = await asyncio.to_thread(download_video, url, workdir)
            title = info.get("title") or "video"
            duration = info.get("duration")

            await status.edit_text("🎵 轉 MP3 中…")
            mp3 = await asyncio.to_thread(extract_mp3, video, duration)

            if video.stat().st_size > MAX_UPLOAD:
                await status.edit_text(f"🗜 影片 {human(video.stat().st_size)} 超過 50 MB，壓縮中…")
                video = await asyncio.to_thread(shrink_video, video, duration)

            await status.edit_text("📤 上傳中…")
            if video:
                with video.open("rb") as f:
                    await msg.reply_video(
                        f, caption=title[:1000], supports_streaming=True,
                        filename=f"{title[:80]}.mp4",
                        read_timeout=300, write_timeout=300,
                    )
            else:
                await msg.reply_text("⚠️ 影片太長，壓到 50 MB 以下就看不清楚了，所以只傳 MP3。")

            if mp3.stat().st_size <= MAX_UPLOAD:
                with mp3.open("rb") as f:
                    await msg.reply_audio(
                        f, title=title[:64], performer=info.get("uploader"),
                        filename=f"{title[:80]}.mp3",
                        read_timeout=300, write_timeout=300,
                    )
            else:
                await msg.reply_text("⚠️ MP3 也超過 50 MB，傳不上去。")

            await status.delete()
        except yt_dlp.utils.DownloadError as e:
            log.warning("download failed for %s: %s", url, e)
            hint = ""
            if "instagram" in url or "facebook" in url:
                hint = "\n（Instagram / Facebook 常需要登入，請設定 YTDLP_COOKIES，見 README）"
            await status.edit_text(f"❌ 下載失敗：{str(e)[:300]}{hint}")
        except Exception as e:
            log.exception("failed for %s", url)
            await status.edit_text(f"❌ 出錯了：{str(e)[:300]}")
        finally:
            shutil.rmtree(workdir, ignore_errors=True)


def main() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise SystemExit("請先設定環境變數 TELEGRAM_BOT_TOKEN")
    if not shutil.which("ffmpeg"):
        raise SystemExit("找不到 ffmpeg，請先安裝（見 README）")

    app = (
        Application.builder()
        .token(token)
        .concurrent_updates(True)
        .build()
    )
    app.add_handler(CommandHandler(["start", "help"], start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    log.info("bot started")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
