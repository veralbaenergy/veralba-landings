/* Hover readout for the illustrative energy-flow chart */
(function () {
  "use strict";
  var box = document.getElementById("flow"), tip = document.getElementById("tip");
  if (!box || !tip) return;
  var svg = box.querySelector("svg"), xh = svg.querySelector("#xh");
  var rows = JSON.parse(box.getAttribute("data-series"));
  var battery = box.getAttribute("data-type") === "battery";
  var L = +svg.getAttribute("data-l"), PW = +svg.getAttribute("data-pw"), W = +svg.getAttribute("data-w");

  function label(h) {
    var hr = Math.floor(h) % 24, m = Math.round((h - Math.floor(h)) * 60);
    var ap = hr < 12 ? "am" : "pm", h12 = hr % 12 === 0 ? 12 : hr % 12;
    return h12 + ":" + (m < 10 ? "0" : "") + m + ap;
  }
  function kw(v) { return v.toFixed(1) + " kW"; }

  function move(ev) {
    var r = svg.getBoundingClientRect();
    var x = (ev.clientX - r.left) / r.width * W;
    var h = Math.max(0, Math.min(24, (x - L) / PW * 24));
    var row = rows[Math.round(h / 0.25)];
    if (!row) return;
    var sx = L + row[0] / 24 * PW;
    xh.setAttribute("x1", sx); xh.setAttribute("x2", sx); xh.setAttribute("opacity", "0.5");
    var lines = [label(row[0]), "Household use: " + kw(row[2]), "Solar: " + kw(row[1])];
    if (battery) lines.push("From battery: " + kw(row[3]));
    lines.push("From grid: " + kw(row[4]));
    tip.innerHTML = lines.join("<br>");
    var br = box.parentNode.parentNode.getBoundingClientRect();
    var px = r.left - br.left + sx / W * r.width;
    tip.style.left = Math.max(80, Math.min(br.width - 80, px)) + "px";
    tip.style.top = (r.top - br.top + 120) + "px";
    tip.classList.add("on");
  }
  function leave() { tip.classList.remove("on"); xh.setAttribute("opacity", "0"); }
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", leave);
})();
