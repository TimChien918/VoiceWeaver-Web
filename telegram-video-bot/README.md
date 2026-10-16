# Telegram 影片下載機器人

把影片網址丟給機器人，它會回傳 **MP4 影片** 和 **MP3 音訊**。
支援 YouTube、X (Twitter)、Instagram、Facebook、TikTok 等 [yt-dlp 支援的網站](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)。

## 安裝

需要 Python 3.10+ 和 ffmpeg。

```bash
# macOS
brew install ffmpeg
# Ubuntu / Debian
sudo apt install ffmpeg
# Windows
winget install ffmpeg

cd telegram-video-bot
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 執行

```bash
export TELEGRAM_BOT_TOKEN="你的 token"       # Windows PowerShell: $env:TELEGRAM_BOT_TOKEN="你的 token"
export ALLOWED_USER_IDS="你的 Telegram id"   # 選填，建議設：只讓自己用
python bot.py
```

然後在 Telegram 打開你的機器人，傳 `/start`，再貼網址就好。
電腦關掉機器人就停了；要 24 小時運作，放到一台常開的機器或 VPS 上跑。

## 限制與注意

- **50 MB 上限**：Telegram 機器人單檔最多傳 50 MB。超過時會自動降畫質壓縮；
  片長太長壓不下來時只傳 MP3。
- **Instagram / Facebook** 常要求登入。用瀏覽器擴充（例如「Get cookies.txt LOCALLY」）
  匯出 cookies.txt，設 `YTDLP_COOKIES=/path/to/cookies.txt`。cookies 等同登入狀態，別外流。
- 網站改版導致下載失敗時，先更新 yt-dlp：`pip install -U yt-dlp`。
- 只下載你有權保存的內容，並遵守各平台的使用條款。
