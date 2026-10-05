/* Veralba Energy — lead form
   - Validates (incl. email typo suggestions)
   - Sends to HubSpot (Forms API v3) AND to a backup script on the same server (lead-backup.php)
   - Success if EITHER one lands, so a HubSpot rejection never loses a lead
   - Sends the GA4 `generate_lead` event (gtag → GA4 → imported into Google Ads) only for real leads
   - TEST mode: ?test=1, or any host that is not *.veralbaenergy.com.au → nothing is sent, no conversion fires
*/
(function () {
  "use strict";

  /* ====== CONFIG — fill these in (see GUIA-SETUP.md) ====== */
  var CONFIG = {
    hubspotPortalId: "443106587",
    hubspotFormGuid: "bd5b2f82-1987-4760-8a82-8e3cafd5dee0",
    // Account is in the AP1 (Australia) data region; the global host is tried first, then the regional one.
    hubspotHosts: ["https://api.hsforms.com", "https://api-ap1.hsforms.com"],
    // HubSpot internal property names. Anything not mapped here is still
    // included, in readable form, inside the "message" property.
    hubspotFields: {
      firstname: "firstname",
      lastname: "lastname",
      email: "email",
      phone: "phone",
      suburb: "city"
    },
    hubspotMessageField: "message",   // the standard "Message" contact property — add it to the form (no new property needed)
    // If HubSpot rejects a field that isn't on the form, we retry with just these:
    hubspotCoreFields: ["firstname", "lastname", "email", "phone"],
    thankYouUrl: "../thank-you/",
    backupUrl: "https://veralbaenergy.com.au/lead-backup.php",     // cPanel script: emails the lead + keeps a copy
    liveHostSuffix: "veralbaenergy.com.au", // anywhere else (e.g. a preview link) runs in TEST mode automatically
    leadEvent: "generate_lead"
  };
  /* ========================================================= */

  var form = document.getElementById("assessment");
  if (!form) return;

  var params = new URLSearchParams(location.search);
  var TEST = params.get("test") === "1" || location.hostname.slice(-CONFIG.liveHostSuffix.length) !== CONFIG.liveHostSuffix;
  var leadType = form.getAttribute("data-lead-type") || "unknown";
  var errBox = form.querySelector(".formerror");
  var btn = form.querySelector("button[type=submit]");
  var btnLabel = btn ? btn.innerHTML : "";

  function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }

  // ---- Attribution: keep UTMs / gclid for the whole visit ----
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid", "fbclid"].forEach(function (k) {
    var v = params.get(k);
    if (v) store("ve_" + k, v);
    var input = form.querySelector('input[name="' + k + '"]');
    if (input) input.value = v || store("ve_" + k) || "";
  });
  var lp = form.querySelector('input[name="landing_page"]');
  if (lp) lp.value = location.origin + location.pathname;
  if (TEST) {
    var tb = document.createElement("div");
    tb.textContent = "PREVIEW / TEST MODE: the form works, but nothing is sent to HubSpot, email or Google Ads.";
    tb.style.cssText = "position:relative;z-index:99;background:#ffa84a;color:#273e31;font:700 13px/1.3 system-ui;padding:9px 16px;text-align:center";
    document.body.insertBefore(tb, document.body.firstChild);
  }

  // ---- Validation ----
  var DOMAINS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.com.au", "bigpond.com", "bigpond.net.au", "icloud.com", "live.com", "live.com.au", "optusnet.com.au", "hotmail.com.au", "outlook.com.au", "me.com", "tpg.com.au", "iinet.net.au"];
  function lev(a, b) {
    var m = [], i, j;
    for (i = 0; i <= b.length; i++) m[i] = [i];
    for (j = 0; j <= a.length; j++) m[0][j] = j;
    for (i = 1; i <= b.length; i++) for (j = 1; j <= a.length; j++)
      m[i][j] = b[i - 1] === a[j - 1] ? m[i - 1][j - 1] : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    return m[b.length][a.length];
  }
  function suggestEmail(v) {
    var at = v.lastIndexOf("@"); if (at < 1) return null;
    var d = v.slice(at + 1).toLowerCase(); if (DOMAINS.indexOf(d) > -1) return null;
    var best = null, score = 3;
    DOMAINS.forEach(function (x) { var s = lev(d, x); if (s < score) { score = s; best = x; } });
    return best ? v.slice(0, at + 1) + best : null;
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  function normPhone(v) {
    var d = (v || "").replace(/[^\d+]/g, "");
    if (d.indexOf("+61") === 0) d = "0" + d.slice(3);
    else if (d.indexOf("61") === 0 && d.length === 11) d = "0" + d.slice(2);
    return d.replace(/\D/g, "");
  }
  function setMsg(name, text, html) {
    var f = form.querySelector('[data-f="' + name + '"]'); if (!f) return;
    var m = f.querySelector(".msg");
    f.classList.toggle("bad", !!text && !html);
    if (m) { if (html) m.innerHTML = html; else m.textContent = text || ""; }
  }
  function val(n) { var el = form.elements[n]; if (!el) return ""; if (el.length && !el.tagName) { for (var i = 0; i < el.length; i++) if (el[i].checked) return el[i].value; return ""; } return (el.value || "").trim(); }

  function validate() {
    var ok = true, first = null;
    function fail(n, t) { ok = false; setMsg(n, t); if (!first) first = form.elements[n] && (form.elements[n].length && !form.elements[n].tagName ? form.elements[n][0] : form.elements[n]); }
    ["firstname", "lastname", "email", "phone", "suburb"].forEach(function (n) { setMsg(n, ""); });
    if (!val("firstname")) fail("firstname", "Please enter your first name.");
    if (!val("lastname")) fail("lastname", "Please enter your last name.");
    var e = val("email");
    if (!EMAIL_RE.test(e)) fail("email", "Please enter a valid email address.");
    var p = normPhone(val("phone"));
    if (!/^0[2-478]\d{8}$/.test(p)) fail("phone", "Please enter a valid Australian phone number.");
    if (val("suburb").length < 3) fail("suburb", "Please enter your suburb or postcode.");
    form.querySelectorAll("[data-required-group]").forEach(function (g) {
      var n = g.getAttribute("data-required-group");
      setMsg(n, "");
      if (!val(n)) fail(n, "Please choose one option.");
    });
    if (first && first.focus) first.focus();
    return ok;
  }

  // email typo hint on blur
  var emailEl = form.elements.email;
  if (emailEl) emailEl.addEventListener("blur", function () {
    var s = suggestEmail(emailEl.value.trim());
    if (s && EMAIL_RE.test(emailEl.value.trim())) {
      setMsg("email", "", 'Did you mean <button type="button" data-fix>' + s.replace(/</g, "") + "</button>?");
      var b = form.querySelector("[data-fix]");
      if (b) b.addEventListener("click", function () { emailEl.value = s; setMsg("email", ""); });
    }
  });

  // ---- Payloads ----
  function readable() {
    var lines = ["Lead type: " + leadType];
    form.querySelectorAll("[data-summary]").forEach(function (el) {
      var n = el.getAttribute("data-summary"), v = val(n);
      if (v) lines.push(el.getAttribute("data-label") + ": " + v);
    });
    lines.push("Suburb/postcode: " + val("suburb"));
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "gclid"].forEach(function (k) { var v = val(k); if (v) lines.push(k + ": " + v); });
    lines.push("Page: " + location.origin + location.pathname);
    return lines.join("\n");
  }
  function cookie(n) { var m = document.cookie.match("(?:^|; )" + n + "=([^;]*)"); return m ? decodeURIComponent(m[1]) : undefined; }

  function hsPost(host, body) {
    return fetch(host + "/submissions/v3/integration/submit/" + CONFIG.hubspotPortalId + "/" + CONFIG.hubspotFormGuid, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(function (r) {
      if (r.ok) return "hubspot";
      return r.text().then(function (t) { var e = new Error("HubSpot " + r.status + " " + t.slice(0, 300)); e.status = r.status; e.body = t; throw e; });
    });
  }
  function hsTryHosts(body, i) {
    i = i || 0;
    return hsPost(CONFIG.hubspotHosts[i], body).catch(function (e) {
      // 404 "form not found" or network error → try the regional host
      if ((!e.status || e.status === 404) && i + 1 < CONFIG.hubspotHosts.length) return hsTryHosts(body, i + 1);
      throw e;
    });
  }
  function sendHubSpot() {
    if (!CONFIG.hubspotPortalId || !CONFIG.hubspotFormGuid) return Promise.reject(new Error("HubSpot not configured"));
    var fields = [];
    Object.keys(CONFIG.hubspotFields).forEach(function (k) {
      var v = k === "phone" ? normPhone(val(k)) : val(k);
      if (CONFIG.hubspotFields[k] && v) fields.push({ name: CONFIG.hubspotFields[k], value: v });
    });
    if (CONFIG.hubspotMessageField) fields.push({ name: CONFIG.hubspotMessageField, value: readable() });
    var body = { fields: fields, context: { pageUri: location.origin + location.pathname + location.search, pageName: document.title } };
    var hutk = cookie("hubspotutk"); if (hutk) body.context.hutk = hutk;
    return hsTryHosts(body).catch(function (e) {
      // A field isn't on the HubSpot form → resend the core contact fields so the contact is still created
      if (e.status === 400 && /FIELD_NOT_IN_FORM/.test(e.body || "")) {
        var core = { fields: fields.filter(function (f) { return CONFIG.hubspotCoreFields.indexOf(f.name) > -1; }), context: body.context };
        return hsTryHosts(core).then(function () { return "hubspot-core"; });
      }
      throw e;
    });
  }
  function sendBackup(hubspotError, hsResult) {
    var fd = new FormData(form);
    fd.set("form_name", form.getAttribute("name"));
    fd.set("phone", normPhone(val("phone")));
    fd.set("summary", readable());
    fd.set("hubspot_status", hubspotError ? "FAILED: " + hubspotError : (hsResult === "hubspot-core" ? "sent (name/email/phone only: add the Message field to the HubSpot form)" : "sent"));
    return fetch(CONFIG.backupUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fd).toString() })
      .then(function (r) { if (!r.ok) throw new Error("Backup " + r.status); return "backup"; });
  }

  function fireConversion(done) {
    var called = false;
    function go() { if (!called) { called = true; done(); } }
    if (typeof window.gtag === "function") {
      window.gtag("event", CONFIG.leadEvent, {
        lead_type: leadType,
        form_id: "veralba_" + leadType,
        event_callback: go,
        event_timeout: 1500
      });
    }
    setTimeout(go, 1800); // never block the redirect if Analytics is blocked
  }

  var busy = false;
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (busy) return;
    if (form.elements.company && form.elements.company.value) return; // honeypot
    errBox.classList.remove("show");
    if (!validate()) return;

    if (TEST) {
      store("ve_first", val("firstname"));
      var tp = form.querySelector(".testpanel");
      tp.style.display = "block";
      tp.textContent = "TEST OK — this is what would be sent:\n\n" + readable() + "\n\nName: " + val("firstname") + " " + val("lastname") + "\nEmail: " + val("email") + "\nPhone: " + normPhone(val("phone")) + "\n\nNo HubSpot, no backup, no conversion.";
      var go = document.createElement("a");
      go.href = CONFIG.thankYouUrl + "?type=" + encodeURIComponent(leadType);
      go.textContent = "See the thank-you page →";
      go.style.cssText = "display:inline-block;margin-top:10px;font-weight:700";
      tp.appendChild(document.createElement("br"));
      tp.appendChild(go);
      return;
    }

    busy = true; btn.disabled = true; btn.textContent = "Sending…";
    var hsErr = null;
    var hs = sendHubSpot().catch(function (e) { hsErr = e.message; throw e; });
    // backup waits briefly for HubSpot so it can record whether HubSpot failed
    var bk = hs.then(function (r) { return sendBackup(null, r); }, function () { return sendBackup(hsErr); });

    Promise.allSettled([hs, bk]).then(function (res) {
      var landed = res.some(function (r) { return r.status === "fulfilled"; });
      if (landed) {
        store("ve_first", val("firstname"));
        fireConversion(function () { location.href = CONFIG.thankYouUrl + "?type=" + encodeURIComponent(leadType); });
      } else {
        busy = false; btn.disabled = false; btn.innerHTML = btnLabel;
        errBox.innerHTML = "Sorry — your details didn't send. Please try again, or call us on <a href='tel:1300165587'>1300 165 587</a>.";
        errBox.classList.add("show");
        if (window.console) console.warn("Lead submit failed", res);
      }
    });
  });

  // ---- Mobile sticky CTA: show once the form is off screen ----
  var sticky = document.querySelector(".sticky"), card = document.getElementById("assessment");
  if (sticky && card && "IntersectionObserver" in window) {
    new IntersectionObserver(function (en) {
      var e = en[0];
      sticky.classList.toggle("show", !e.isIntersecting && e.boundingClientRect.top < 0);
    }, { threshold: 0 }).observe(card);
  }
})();
