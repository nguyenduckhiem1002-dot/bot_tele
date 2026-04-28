// /api/health.js
module.exports = async function handler(req, res) {
  res.status(200).json({
    status: "ok",
    service: "sap-chart-telegram-bot",
    timestamp: new Date().toISOString(),
    usage: {
      endpoint: "POST /api/chart",
      body: {
        bot_token: "your_telegram_bot_token",
        chat_id: "your_chat_id",
        caption: "optional caption",
        data: [{ e: "EXT_SYS", d: "YYYYMMDD", f: 123 }],
      },
    },
  });
};
