// 開發者控制中心（js/admin.js）的介面字串。
//
// 跟 i18n-sml.js 同一個做法：另開一支、直接把鍵併進同一個 STRINGS 物件，
// t()、data-i18n、applyI18n 照舊運作。分開放是因為 i18n.js 很大、常有其他工作同時在改。
// app.js 在匯入 i18n.js 之前先匯入這支。
//
// 這一頁只有開發者看得到，但仍然四種語言都給：介面語言切成英文時，
// 半頁中文半頁英文會讓「這是不是壞掉了」變得很難判斷。
import { STRINGS } from "./i18n.js?v=1.6.1";

Object.assign(STRINGS, {
  "adm.title": { "zh-TW":"🛠 開發者控制中心", "en":"🛠 Developer console", "ja":"🛠 開発者コンソール", "ko":"🛠 개발자 콘솔" },
  "adm.desc": { "zh-TW":"只有開發者帳號看得到這一頁。每一筆寫入都會由 Firestore 規則再驗證一次——新版規則還沒部署的話，這裡的按鈕會一律被拒絕。",
                "en":"Only the developer account can see this page. Every write is checked again by the Firestore rules — if the new rules haven't been deployed, every action here will be refused.",
                "ja":"このページは開発者アカウントにだけ表示されます。書き込みはすべて Firestore ルールで再検証されます。新しいルールが未デプロイなら、ここの操作はすべて拒否されます。",
                "ko":"이 페이지는 개발자 계정에만 보입니다. 모든 쓰기는 Firestore 규칙에서 다시 검증되며, 새 규칙이 배포되지 않았다면 여기의 모든 작업이 거부됩니다." },
  "adm.refresh": { "zh-TW":"↻ 重新讀取", "en":"↻ Reload", "ja":"↻ 再読み込み", "ko":"↻ 다시 불러오기" },
  "adm.loading": { "zh-TW":"讀取中…", "en":"Loading…", "ja":"読み込み中…", "ko":"불러오는 중…" },
  "adm.denied": { "zh-TW":"被 Firestore 規則拒絕：請確認新版 firestore.rules 已部署，而且登入的是開發者帳號。",
                  "en":"Refused by the Firestore rules: make sure the new firestore.rules is deployed and you are signed in with the developer account.",
                  "ja":"Firestore ルールに拒否されました。新しい firestore.rules がデプロイ済みで、開発者アカウントでログインしているか確認してください。",
                  "ko":"Firestore 규칙에서 거부되었습니다. 새 firestore.rules가 배포되었는지, 개발자 계정으로 로그인했는지 확인하세요." },
  "adm.loadFail": { "zh-TW":"讀取失敗：", "en":"Couldn't load: ", "ja":"読み込みに失敗：", "ko":"불러오기 실패: " },
  "adm.writeFail": { "zh-TW":"寫入失敗：", "en":"Write failed: ", "ja":"書き込みに失敗：", "ko":"쓰기 실패: " },
  "adm.updated": { "zh-TW":"上次更新：{who}，{t}", "en":"Last updated by {who}, {t}", "ja":"最終更新：{who}（{t}）", "ko":"마지막 수정: {who}, {t}" },

  // ── 三個區塊 ──
  "adm.secShared": { "zh-TW":"📢 全站活動", "en":"📢 Site-wide campaign", "ja":"📢 全体キャンペーン", "ko":"📢 전체 이벤트" },
  "adm.secGrant": { "zh-TW":"🎁 單獨發放", "en":"🎁 Individual grants", "ja":"🎁 個別付与", "ko":"🎁 개별 지급" },
  "adm.secAccounts": { "zh-TW":"👥 帳號管理", "en":"👥 Accounts", "ja":"👥 アカウント管理", "ko":"👥 계정 관리" },

  // ── 狀態 ──
  "adm.stActive": { "zh-TW":"進行中", "en":"Live", "ja":"実施中", "ko":"진행 중" },
  "adm.stScheduled": { "zh-TW":"尚未開始", "en":"Scheduled", "ja":"開始前", "ko":"시작 전" },
  "adm.stEnded": { "zh-TW":"已結束", "en":"Ended", "ja":"終了", "ko":"종료됨" },
  "adm.stDisabled": { "zh-TW":"已停用", "en":"Disabled", "ja":"停止中", "ko":"중지됨" },
  "adm.stNone": { "zh-TW":"尚未設定", "en":"Not set up", "ja":"未設定", "ko":"설정 안 됨" },
  "adm.summary": { "zh-TW":"{status}｜{from} ～ {until}｜每人每日 {limit} 次｜金鑰：文字 {llm}、生圖 {image}、語音 {tts}",
                   "en":"{status} · {from} – {until} · {limit}/person/day · keys: text {llm}, image {image}, voice {tts}",
                   "ja":"{status}｜{from}～{until}｜1人1日 {limit} 回｜キー：テキスト {llm}・画像 {image}・音声 {tts}",
                   "ko":"{status} · {from} ~ {until} · 1인 1일 {limit}회 · 키: 텍스트 {llm}, 이미지 {image}, 음성 {tts}" },

  // ── 表單 ──
  "adm.enabled": { "zh-TW":"啟用", "en":"Enabled", "ja":"有効", "ko":"사용" },
  "adm.from": { "zh-TW":"開始日", "en":"Start date", "ja":"開始日", "ko":"시작일" },
  "adm.to": { "zh-TW":"結束日（含當天）", "en":"End date (inclusive)", "ja":"終了日（当日を含む）", "ko":"종료일 (당일 포함)" },
  "adm.limit": { "zh-TW":"每人每日次數", "en":"Uses per person per day", "ja":"1人1日の回数", "ko":"1인 1일 횟수" },
  "adm.keys_llm": { "zh-TW":"💬 文字金鑰", "en":"💬 Text keys", "ja":"💬 テキスト用キー", "ko":"💬 텍스트 키" },
  "adm.keys_image": { "zh-TW":"🖼 生圖金鑰", "en":"🖼 Image keys", "ja":"🖼 画像生成用キー", "ko":"🖼 이미지 키" },
  "adm.keys_tts": { "zh-TW":"🔊 語音金鑰", "en":"🔊 Voice keys", "ja":"🔊 音声用キー", "ko":"🔊 음성 키" },
  "adm.noKeys": { "zh-TW":"（沒有）", "en":"(none)", "ja":"（なし）", "ko":"(없음)" },
  "adm.addKey": { "zh-TW":"＋ 新增", "en":"＋ Add", "ja":"＋ 追加", "ko":"＋ 추가" },
  "adm.delKey": { "zh-TW":"移除", "en":"Remove", "ja":"削除", "ko":"삭제" },
  "adm.keyPh": { "zh-TW":"貼上金鑰", "en":"Paste key", "ja":"キーを貼り付け", "ko":"키 붙여넣기" },
  "adm.keyKeepPh": { "zh-TW":"{mask}（留空＝保留原金鑰）", "en":"{mask} (leave blank to keep)", "ja":"{mask}（空欄＝そのまま）", "ko":"{mask} (비워 두면 유지)" },
  "adm.modelPh": { "zh-TW":"模型（留空＝{model}）", "en":"Model (blank = {model})", "ja":"モデル（空欄＝{model}）", "ko":"모델 (비우면 {model})" },
  "adm.acctPh": { "zh-TW":"Cloudflare 帳戶 ID", "en":"Cloudflare account ID", "ja":"Cloudflare アカウント ID", "ko":"Cloudflare 계정 ID" },
  "adm.importMine": { "zh-TW":"📥 從我的設定匯入金鑰", "en":"📥 Import keys from my settings", "ja":"📥 自分の設定からキーを取り込む", "ko":"📥 내 설정에서 키 가져오기" },
  "adm.imported": { "zh-TW":"已匯入 {n} 把金鑰（重複的略過）", "en":"Imported {n} key(s) (duplicates skipped)", "ja":"{n} 個のキーを取り込みました（重複は省略）", "ko":"키 {n}개를 가져왔습니다 (중복 제외)" },
  "adm.importedNone": { "zh-TW":"你的設定裡沒有可匯入的新金鑰", "en":"No new keys to import from your settings", "ja":"取り込める新しいキーがありません", "ko":"가져올 새 키가 없습니다" },
  "adm.saveShared": { "zh-TW":"💾 儲存全站活動", "en":"💾 Save campaign", "ja":"💾 キャンペーンを保存", "ko":"💾 이벤트 저장" },
  "adm.stopNow": { "zh-TW":"⛔ 立即停用", "en":"⛔ Stop now", "ja":"⛔ 今すぐ停止", "ko":"⛔ 즉시 중지" },
  "adm.saved": { "zh-TW":"✅ 已儲存", "en":"✅ Saved", "ja":"✅ 保存しました", "ko":"✅ 저장했습니다" },
  "adm.stopped": { "zh-TW":"⛔ 已停用", "en":"⛔ Stopped", "ja":"⛔ 停止しました", "ko":"⛔ 중지했습니다" },
  "adm.revoked": { "zh-TW":"已收回", "en":"Revoked", "ja":"取り消しました", "ko":"회수했습니다" },
  "adm.deleted": { "zh-TW":"已刪除", "en":"Deleted", "ja":"削除しました", "ko":"삭제했습니다" },

  // ── 二次確認 ──
  "adm.confirmShared": { "zh-TW":"確定要寫入全站活動？\n\n{summary}", "en":"Write the site-wide campaign?\n\n{summary}", "ja":"全体キャンペーンを書き込みますか？\n\n{summary}", "ko":"전체 이벤트를 저장할까요?\n\n{summary}" },
  "adm.confirmStop": { "zh-TW":"確定要立即停用全站活動？\n所有人下次載入時就借不到金鑰了（已流出的金鑰仍有效，記得到供應商後台換掉）。",
                       "en":"Stop the site-wide campaign now?\nNobody can borrow the keys from their next page load (keys already handed out stay valid — rotate them at the provider).",
                       "ja":"全体キャンペーンを今すぐ停止しますか？\n次回の読み込みから誰もキーを借りられなくなります（配布済みのキーは有効なままなので、提供元で更新してください）。",
                       "ko":"전체 이벤트를 지금 중지할까요?\n다음 로드부터 아무도 키를 빌릴 수 없습니다 (이미 배포된 키는 유효하므로 제공업체에서 교체하세요)." },
  "adm.confirmGrant": { "zh-TW":"確定要發放給 {who}？\n\n{summary}", "en":"Grant to {who}?\n\n{summary}", "ja":"{who} に付与しますか？\n\n{summary}", "ko":"{who}에게 지급할까요?\n\n{summary}" },
  "adm.confirmRevoke": { "zh-TW":"確定要收回 {who} 的發放？（文件保留，改成停用）", "en":"Revoke the grant for {who}? (The record is kept, just disabled.)", "ja":"{who} への付与を取り消しますか？（記録は残し、停止にします）", "ko":"{who}의 지급을 회수할까요? (기록은 남기고 중지로 바꿉니다)" },
  "adm.confirmDelete": { "zh-TW":"確定要刪除 {who} 的發放？這個動作無法復原。", "en":"Delete the grant for {who}? This can't be undone.", "ja":"{who} への付与を削除しますか？元に戻せません。", "ko":"{who}의 지급을 삭제할까요? 되돌릴 수 없습니다." },

  // ── 驗證錯誤 ──
  "adm.errDates": { "zh-TW":"請填開始日與結束日", "en":"Please fill in both the start and end dates", "ja":"開始日と終了日を入力してください", "ko":"시작일과 종료일을 입력하세요" },
  "adm.errOrder": { "zh-TW":"結束日不能早於開始日", "en":"The end date can't be before the start date", "ja":"終了日は開始日より前にできません", "ko":"종료일은 시작일보다 앞설 수 없습니다" },
  "adm.errLimit": { "zh-TW":"每日次數要是 1～100000 的整數", "en":"Daily uses must be a whole number from 1 to 100000", "ja":"1日の回数は 1～100000 の整数にしてください", "ko":"하루 횟수는 1~100000 사이의 정수여야 합니다" },
  "adm.errKeyEmpty": { "zh-TW":"有一列金鑰是空的（或含空白），請填好或移除那一列", "en":"A key row is empty (or contains spaces) — fill it in or remove it", "ja":"空の（または空白を含む）キー行があります。入力するか削除してください", "ko":"비어 있거나 공백이 있는 키 행이 있습니다. 입력하거나 삭제하세요" },
  "adm.errAccount": { "zh-TW":"Cloudflare 需要填帳戶 ID", "en":"Cloudflare needs an account ID", "ja":"Cloudflare にはアカウント ID が必要です", "ko":"Cloudflare는 계정 ID가 필요합니다" },
  "adm.errNoKeys": { "zh-TW":"至少要有一把金鑰才能啟用", "en":"Add at least one key before enabling", "ja":"有効にするには少なくとも1つのキーが必要です", "ko":"사용하려면 키가 최소 1개 필요합니다" },
  "adm.errInherit": { "zh-TW":"全站那份目前沒有金鑰可以沿用，請取消勾選並自己填金鑰", "en":"The site-wide campaign has no keys to reuse — untick it and add keys", "ja":"全体キャンペーンに流用できるキーがありません。チェックを外してキーを追加してください", "ko":"전체 이벤트에 재사용할 키가 없습니다. 체크를 해제하고 키를 추가하세요" },
  "adm.errPast": { "zh-TW":"結束日已經過了，啟用也不會生效", "en":"The end date has already passed, so enabling would have no effect", "ja":"終了日が過ぎているため、有効にしても反映されません", "ko":"종료일이 이미 지나서 사용으로 해도 적용되지 않습니다" },
  "adm.errNoUser": { "zh-TW":"請先從名冊選一個帳號", "en":"Pick an account from the directory first", "ja":"まず名簿からアカウントを選んでください", "ko":"먼저 명부에서 계정을 선택하세요" },

  // ── 單獨發放 ──
  "adm.search": { "zh-TW":"搜尋帳號（email／名字）", "en":"Find an account (email / name)", "ja":"アカウント検索（メール／名前）", "ko":"계정 검색 (이메일 / 이름)" },
  "adm.searchPh": { "zh-TW":"輸入 email 或名字", "en":"Type an email or name", "ja":"メールまたは名前を入力", "ko":"이메일 또는 이름 입력" },
  "adm.noMatch": { "zh-TW":"名冊裡找不到符合的帳號（對方要先用 Google 登入一次才會出現）", "en":"No matching account (people appear after signing in with Google once)", "ja":"該当するアカウントがありません（一度 Google でログインすると表示されます）", "ko":"일치하는 계정이 없습니다 (Google로 한 번 로그인해야 표시됩니다)" },
  "adm.pick": { "zh-TW":"選取", "en":"Select", "ja":"選択", "ko":"선택" },
  "adm.selected": { "zh-TW":"發放對象：{who}", "en":"Granting to: {who}", "ja":"付与先：{who}", "ko":"지급 대상: {who}" },
  "adm.inherit": { "zh-TW":"沿用全站那份的金鑰（儲存當下複製一份）", "en":"Reuse the site-wide keys (copied at save time)", "ja":"全体キャンペーンのキーを流用（保存時にコピー）", "ko":"전체 이벤트의 키 재사용 (저장 시 복사)" },
  "adm.saveGrant": { "zh-TW":"💾 發放／更新", "en":"💾 Grant / update", "ja":"💾 付与／更新", "ko":"💾 지급 / 수정" },
  "adm.grantsList": { "zh-TW":"現有的單獨發放", "en":"Existing grants", "ja":"現在の個別付与", "ko":"현재 개별 지급" },
  "adm.noGrants": { "zh-TW":"目前沒有單獨發放", "en":"No individual grants yet", "ja":"個別付与はまだありません", "ko":"개별 지급이 아직 없습니다" },
  "adm.edit": { "zh-TW":"編輯", "en":"Edit", "ja":"編集", "ko":"편집" },
  "adm.revoke": { "zh-TW":"收回", "en":"Revoke", "ja":"取り消し", "ko":"회수" },
  "adm.delete": { "zh-TW":"刪除", "en":"Delete", "ja":"削除", "ko":"삭제" },

  // ── 帳號管理 ──
  "adm.dirCount": { "zh-TW":"名冊共 {n} 個帳號（今天的用量以 UTC {day} 計，跟計數文件一致）", "en":"{n} account(s) in the directory (today's usage counted for UTC {day}, matching the counters)", "ja":"名簿に {n} 件（本日の利用回数は UTC {day} で集計。カウンターと同じ基準）", "ko":"명부에 {n}개 계정 (오늘 사용량은 UTC {day} 기준, 카운터와 동일)" },
  "adm.noDir": { "zh-TW":"名冊是空的。使用者用 Google 登入後才會自動登記。", "en":"The directory is empty. People are added automatically after they sign in with Google.", "ja":"名簿は空です。Google でログインすると自動で登録されます。", "ko":"명부가 비어 있습니다. Google로 로그인하면 자동으로 등록됩니다." },
  "adm.filterPh": { "zh-TW":"篩選 email／名字", "en":"Filter by email / name", "ja":"メール／名前で絞り込み", "ko":"이메일 / 이름으로 필터" },
  "adm.lastSeen": { "zh-TW":"最後上線 {t}", "en":"Last seen {t}", "ja":"最終ログイン {t}", "ko":"마지막 접속 {t}" },
  "adm.usage": { "zh-TW":"今天借用 {n} 次", "en":"{n} borrowed today", "ja":"本日 {n} 回利用", "ko":"오늘 {n}회 사용" },
  "adm.usageNA": { "zh-TW":"今天用量讀不到", "en":"Today's usage unavailable", "ja":"本日の利用回数を取得できません", "ko":"오늘 사용량을 읽을 수 없음" },
  "adm.hasGrant": { "zh-TW":"🎁 有單獨發放（{status}）", "en":"🎁 Has a grant ({status})", "ja":"🎁 個別付与あり（{status}）", "ko":"🎁 개별 지급 있음 ({status})" },
  "adm.noGrant": { "zh-TW":"無單獨發放", "en":"No grant", "ja":"個別付与なし", "ko":"개별 지급 없음" },
  "adm.grantThis": { "zh-TW":"發放", "en":"Grant", "ja":"付与", "ko":"지급" },
  "adm.unnamed": { "zh-TW":"（未命名）", "en":"(no name)", "ja":"（名前なし）", "ko":"(이름 없음)" },
});
