from telegram import Update
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes

# 1. ضع رمز البوت الخاص بك هنا
TOKEN = "8952904177:AAE1PkTVojrQ7uhg_eTioR3WeJQiVy9fdqc"

# 2. ضع الاسم القصير للعبة الذي اخترته في BotFather
GAME_SHORT_NAME = "Card"

# 3. ضع رابط لعبة GitHub Pages هنا
GAME_URL = "https://debobatman-png.github.io/Card-win/"

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # إرسال بطاقة اللعبة للمستخدم عند كتابة /start
    await update.message.reply_game(game_short_name=GAME_SHORT_NAME)

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    # فتح رابط اللعبة عند ضغط المستخدم على زر اللعب
    if query.game_short_name == GAME_SHORT_NAME:
        await query.answer(url=GAME_URL)

def main():
    # بناء وتشغيل البوت باسم متغير موحد
    app = Application.builder().token(TOKEN).build()
    
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(button_callback))
    
    print("البوت يعمل الآن بنجاح...")
    app.run_polling()

if __name__ == "__main__":
    main()
