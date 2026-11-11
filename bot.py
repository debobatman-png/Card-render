from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

# ضع رمز البوت الخاص بك هنا
TOKEN = "8952904177:AAE1PkTVojrQ7uhg_eTioR3WeJQiVy9fdqc"

# ضع رابط لعبة GitHub Pages هنا
GAME_URL = "https://debobatman-png.github.io/Card-win/"

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # زر يفتح ملف index.html مباشرة دون الحاجة لـ newgame أو موافقة السيرفر
    keyboard = [
        [InlineKeyboardButton("🎮 العب الآن", web_app=WebAppInfo(url=GAME_URL))]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(
        "مرحباً بك في اللعبة! اضغط على الزر بالأسفل للبدء:",
        reply_markup=reply_markup
    )

def main():
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    
    print("البوت يعمل الآن بنجاح...")
    app.run_polling()

if __name__ == "__main__":
    main()
