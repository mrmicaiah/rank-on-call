/* Post-payment confirmation front-end — consumes /api/confirm-business.
 *
 * HARD RULES (mirroring assets/js/scan.js):
 *  - No key ever touches this page. Every lookup goes through the server endpoint.
 *  - All server-derived strings (business names, addresses from Google) are
 *    inserted via textContent, never innerHTML — treat as untrusted.
 *  - Paid status is decided server-side; this page never asserts it.
 *  - No-verdict rule: the success panel says research is underway, never an
 *    outcome or finding.
 */
(function () {
  "use strict";

  var loadingEl = document.getElementById("confirm-loading");
  var mainEl = document.getElementById("confirm-main");
  var doneEl = document.getElementById("confirm-done");
  var errorEl = document.getElementById("confirm-error");
  var errorTitle = document.getElementById("confirm-error-title");
  var errorBody = document.getElementById("confirm-error-body");

  var form = document.getElementById("confirm-form");
  var candidatesEl = document.getElementById("confirm-candidates");
  var manualEl = document.getElementById("confirm-manual");
  var manualAddress = document.getElementById("manual-address");
  var manualPhone = document.getElementById("manual-phone");
  var attestBox = document.getElementById("confirm-attest-box");
  var submit = document.getElementById("confirm-submit");
  var msg = document.getElementById("confirm-msg");
  var prompt = document.getElementById("confirm-prompt");

  // Selection state, held in memory — the submit reads from here, never the DOM text.
  var selected = null; // null | {manual:true} | {place_id, name, address}
  var candidateData = []; // parallel to rendered radios, indexed by value

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text; // textContent ALWAYS — untrusted strings
    return node;
  }

  function show(node) { if (node) node.hidden = false; }
  function hide(node) { if (node) node.hidden = true; }

  function getSessionId() {
    try {
      return new URLSearchParams(window.location.search).get("session_id");
    } catch (e) {
      return null;
    }
  }

  function showError(title, body) {
    hide(loadingEl);
    hide(mainEl);
    hide(doneEl);
    errorTitle.textContent = title;
    errorBody.textContent = body;
    show(errorEl);
  }

  /* ---------------------------- candidate cards ---------------------------- */

  function ratingLine(c) {
    if (typeof c.rating !== "number") return "";
    var line = c.rating.toFixed(1) + " on Google";
    if (typeof c.user_ratings_total === "number") {
      line += " · " + c.user_ratings_total + (c.user_ratings_total === 1 ? " review" : " reviews");
    }
    return line;
  }

  function buildCandidateCard(c, index) {
    var value = "cand-" + index;
    var label = el("label", "confirm-candidate");
    label.setAttribute("for", value);

    var radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "candidate";
    radio.id = value;
    radio.value = value;
    radio.className = "confirm-candidate__radio";

    var textWrap = el("div", "confirm-candidate__text");
    textWrap.appendChild(el("span", "confirm-candidate__name", c.name || "This business"));
    if (c.formatted_address) textWrap.appendChild(el("span", "confirm-candidate__addr", c.formatted_address));
    if (c.formatted_phone_number) textWrap.appendChild(el("span", "confirm-candidate__meta", c.formatted_phone_number));
    var r = ratingLine(c);
    if (r) textWrap.appendChild(el("span", "confirm-candidate__meta", r));

    label.appendChild(radio);
    label.appendChild(textWrap);

    radio.addEventListener("change", function () {
      selectCard(label, { place_id: c.place_id, name: c.name || "", address: c.formatted_address || "" });
    });

    return label;
  }

  function buildNoneCard(index) {
    var value = "cand-none";
    var label = el("label", "confirm-candidate confirm-candidate--none");
    label.setAttribute("for", value);

    var radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "candidate";
    radio.id = value;
    radio.value = value;
    radio.className = "confirm-candidate__radio";

    var textWrap = el("div", "confirm-candidate__text");
    textWrap.appendChild(el("span", "confirm-candidate__name", "None of these"));
    textWrap.appendChild(el("span", "confirm-candidate__addr", "My business isn't listed here — I'll enter it myself."));

    label.appendChild(radio);
    label.appendChild(textWrap);

    radio.addEventListener("change", function () {
      selectCard(label, { manual: true });
    });

    return label;
  }

  function clearSelectedStyling() {
    var cards = candidatesEl.querySelectorAll(".confirm-candidate");
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove("is-selected");
  }

  function selectCard(labelEl, choice) {
    clearSelectedStyling();
    labelEl.classList.add("is-selected");
    selected = choice;
    if (choice && choice.manual) {
      show(manualEl);
    } else {
      hide(manualEl);
    }
    refreshSubmit();
  }

  /* ----------------------------- submit gating ----------------------------- */

  function choiceIsComplete() {
    if (!selected) return false;
    if (selected.manual) return manualAddress.value.trim().length > 0;
    return Boolean(selected.place_id);
  }

  function refreshSubmit() {
    // Disabled until a choice is made AND the attestation box is checked.
    submit.disabled = !(choiceIsComplete() && attestBox.checked);
  }

  /* ------------------------------- rendering ------------------------------- */

  function renderCandidates(data) {
    hide(loadingEl);
    show(mainEl);

    // Tune the prompt to whether Google gave us anything to pick from.
    var haveCandidates = data.candidates && data.candidates.length;
    var name = data.business && data.business.name;

    if (!haveCandidates) {
      // Zero results, no query, or a Places outage → straight to the manual form.
      if (data.placesStatus === "unavailable") {
        prompt.textContent = "Our Google lookup didn't come back just now — that's on us, not you. Enter your business details below and we'll research it by hand.";
      } else {
        prompt.textContent = name
          ? ("We couldn't find a Google listing for “" + name + "” automatically. Enter your details below and we'll take it from there.")
          : "Enter your business details below so we research the right company.";
      }
      // Only the "None of these" path — reveal the manual form and preselect it.
      var none = buildNoneCard(0);
      candidatesEl.appendChild(none);
      var noneRadio = none.querySelector("input");
      noneRadio.checked = true;
      selectCard(none, { manual: true });
      return;
    }

    data.candidates.forEach(function (c, i) {
      candidateData[i] = c;
      candidatesEl.appendChild(buildCandidateCard(c, i));
    });
    candidatesEl.appendChild(buildNoneCard(data.candidates.length));
  }

  /* -------------------------------- submit --------------------------------- */

  function handleSubmit(e) {
    e.preventDefault();
    if (submit.disabled) return;
    msg.textContent = "";

    var sessionId = getSessionId();
    var payload = { session_id: sessionId, attested: attestBox.checked === true };

    if (selected.manual) {
      var addr = manualAddress.value.trim();
      if (!addr) {
        msg.textContent = "Please enter your business street address.";
        return;
      }
      payload.manual_details = { address: addr, phone: manualPhone.value.trim() };
    } else {
      payload.place_id = selected.place_id;
      payload.name = selected.name;
      payload.address = selected.address;
    }

    submit.disabled = true;
    var restore = submit.textContent;
    submit.textContent = "Confirming…";

    fetch("/api/confirm-business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
      .then(function (r) {
        if (r.ok && r.body && r.body.status === "ok") {
          hide(mainEl);
          show(doneEl);
          doneEl.focus && doneEl.focus();
        } else {
          submit.disabled = false;
          submit.textContent = restore;
          msg.textContent = (r.body && r.body.message) || "We couldn't save your confirmation. Please try again.";
          refreshSubmit();
        }
      })
      .catch(function () {
        submit.disabled = false;
        submit.textContent = restore;
        msg.textContent = "We couldn't reach us just now — please try again in a moment.";
        refreshSubmit();
      });
  }

  /* --------------------------------- init ---------------------------------- */

  function init() {
    var sessionId = getSessionId();
    if (!sessionId) {
      showError(
        "We couldn't find your order.",
        "This page needs the order link from your payment confirmation. If you just paid, use the button on your receipt — or email us and we'll help."
      );
      return;
    }

    if (form) {
      form.addEventListener("submit", handleSubmit);
      attestBox.addEventListener("change", refreshSubmit);
      manualAddress.addEventListener("input", refreshSubmit);
    }

    fetch("/api/confirm-business?session_id=" + encodeURIComponent(sessionId), {
      headers: { "Accept": "application/json" },
    })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
      .then(function (r) {
        if (r.ok && r.body && r.body.status === "ok") {
          renderCandidates(r.body);
          return;
        }
        var code = r.body && r.body.code;
        if (code === "unpaid") {
          showError("This order isn't showing as paid yet.", (r.body && r.body.message) || "If you just completed checkout, refresh in a moment.");
        } else if (code === "missing_session" || code === "invalid_session") {
          showError("We couldn't find that order.", (r.body && r.body.message) || "If you just paid, give it a moment and refresh this page.");
        } else {
          showError("We couldn't load your order.", (r.body && r.body.message) || "Please refresh in a moment, or email us and we'll help.");
        }
      })
      .catch(function () {
        showError("We couldn't load your order.", "That's on us, not you. Refresh in a moment — if it keeps happening, email us and we'll finish this by hand.");
      });
  }

  init();
})();
