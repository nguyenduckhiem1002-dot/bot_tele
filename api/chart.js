// /api/chart.js
// SAP POST JSON → QuickChart.io render PNG → send to Telegram
//
// Body: { bot_token, chat_id, caption?, data: [{e,d,f},...] }

const COLORS = [
  "#2563eb","#dc2626","#16a34a","#d97706","#7c3aed","#db2777",
  "#0891b2","#65a30d","#ea580c","#4f46e5","#059669","#e11d48",
  "#0284c7","#ca8a04","#9333ea","#be123c","#0d9488","#c2410c",
  "#6d28d9","#15803d","#b91c1c","#0369a1","#a16207","#7e22ce",
  "#1d4ed8","#047857","#9f1239","#1e40af","#92400e","#6b21a8",
  "#166534","#991b1b","#075985","#854d0e","#581c87","#14532d",
  "#7f1d1d","#0c4a6e","#713f12","#3b0764"
];

function buildChartConfig(raw) {
  const dateMap = {};
  const sysMap = {};

  raw.forEach((r) => {
    dateMap[r.d] = true;
    if (!sysMap[r.e]) sysMap[r.e] = {};
    sysMap[r.e][r.d] = (sysMap[r.e][r.d] || 0) + r.f;
  });

  const dates = Object.keys(dateMap).sort();
  const extList = Object.keys(sysMap).sort();

  const dateLabels = dates.map(
    (d) => d.substring(6, 8) + "/" + d.substring(4, 6)
  );

  let totalFail = 0;
  const datasets = extList.map((es, i) => {
    const data = dates.map((d) => {
      const v = sysMap[es][d] || 0;
      totalFail += v;
      return v;
    });
    return {
      label: es,
      data,
      borderColor: COLORS[i % COLORS.length],
      backgroundColor: COLORS[i % COLORS.length] + "20",
      borderWidth: 2,
      pointRadius: data.map((v) => (v > 0 ? 3 : 0)),
      tension: 0.3,
      fill: false,
    };
  });

  const fmtDate = (d) =>
    d.substring(6,8) + "/" + d.substring(4,6) + "/" + d.substring(0,4);

  const dateRange = dates.length > 0
    ? fmtDate(dates[0]) + " - " + fmtDate(dates[dates.length - 1])
    : "";

  const fmt = (n) => {
    if (n >= 1e6) return (n/1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n/1e3).toFixed(1) + "K";
    return String(n);
  };

  const titleText = "Fail Count by EXT_SYS  |  Total: " + fmt(totalFail)
    + "  |  " + extList.length + " systems  |  " + dateRange;

  return {
    type: "line",
    data: { labels: dateLabels, datasets },
    options: {
      plugins: {
        title: {
          display: true,
          text: titleText,
          font: { size: 14, weight: "bold" },
          color: "#1e293b",
          padding: { bottom: 16 },
        },
        legend: {
          display: true,
          position: "bottom",
          labels: { font: { size: 10 }, boxWidth: 12, padding: 10 },
        },
        datalabels: {
          display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
          color: (ctx) => ctx.dataset.borderColor,
          font: { size: 8, weight: "bold" },
          anchor: "end",
          align: "top",
          offset: 2,
          formatter: (val) => {
            if (!val) return "";
            if (val >= 1e6) return (val/1e6).toFixed(1) + "M";
            if (val >= 1e3) return (val/1e3).toFixed(1) + "K";
            return val;
          },
        },
      },
      scales: {
        x: {
          grid: { color: "#f1f5f9" },
          ticks: { font: { size: 9 }, maxRotation: 60, autoSkip: true, maxTicksLimit: 30 },
        },
        y: {
          grid: { color: "#f1f5f9" },
          ticks: {
            font: { size: 10 },
            callback: (v) => {
              if (v >= 1e6) return (v/1e6).toFixed(1) + "M";
              if (v >= 1e3) return (v/1e3).toFixed(1) + "K";
              return v;
            },
          },
        },
      },
    },
  };
}

async function renderPNG(raw) {
  const chartConfig = buildChartConfig(raw);

  const resp = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "4",
      backgroundColor: "#f8fafc",
      width: 1500,
      height: 600,
      devicePixelRatio: 2,
      chart: chartConfig,
    }),
  });

  if (!resp.ok) {
    throw new Error("QuickChart error " + resp.status + ": " + (await resp.text()));
  }

  return Buffer.from(await resp.arrayBuffer());
}

async function sendTelegramPhoto(botToken, chatId, pngBuf, caption) {
  const boundary = "----Boundary" + Date.now();

  let preamble = "";
  preamble += "--" + boundary + "\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n" + chatId + "\r\n";
  if (caption) {
    preamble += "--" + boundary + "\r\nContent-Disposition: form-data; name=\"caption\"\r\n\r\n" + caption + "\r\n";
  }
  preamble += "--" + boundary + "\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"chart.png\"\r\nContent-Type: image/png\r\n\r\n";

  const epilogue = "\r\n--" + boundary + "--\r\n";

  const body = Buffer.concat([
    Buffer.from(preamble, "utf-8"),
    pngBuf,
    Buffer.from(epilogue, "utf-8"),
  ]);

  const resp = await fetch("https://api.telegram.org/bot" + botToken + "/sendPhoto", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=" + boundary },
    body,
  });

  return await resp.json();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { bot_token, chat_id, caption, data } = req.body;

    if (!bot_token || !chat_id || !data || !Array.isArray(data) || !data.length) {
      return res.status(400).json({ error: "Required: bot_token, chat_id, data[]" });
    }

    const png = await renderPNG(data);
    const tg = await sendTelegramPhoto(bot_token, chat_id, png, caption || "Fail Chart");

    if (!tg.ok) {
      return res.status(502).json({ error: "Telegram error", details: tg });
    }

    return res.status(200).json({ success: true, message_id: tg.result.message_id });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
