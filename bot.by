import os
import threading
from flask import Flask
from telegram import Update
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes

# ضع بياناتك هنا
TOKEN = "8952904177:AAE1PkTVojrQ7uhg_eTioR3WeJQiVy9fdqc"
GAME_SHORT_NAME = "Card"
GAME_URL = "https://debobatman-png.github.io/Card-win/"



@app.route('/')
def home():
    return "البوت يعمل بنجاح!"

def run_flask():
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

# أوامر بوت تيليجرام
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_game(game_short_name=GAME_SHORT_NAME)

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if query.game_short_name == GAME_SHORT_NAME:
        await query.answer(url=GAME_URL)

def main():
    # تشغيل خادم الويب في الخلفية
    threading.Thread(target=run_flask, daemon=True).start()
    
    # تشغيل بوت تيليجرام
    bot_app = Application.builder().token(TOKEN).build()
    bot_app.add_handler(CommandHandler("start", start))
    bot_app.add_handler(CallbackQueryHandler(button_callback))
    bot_app.run_polling()

if __name__ == "__main__":
    main()
