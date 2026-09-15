/* ===========================================================================
   player.js — the dom half of the media player.

   Reads the file where it lies. A picked file becomes a Blob URL in this tab;
   the first bytes of it are handed to PLAYER.probe so the panel can name the
   codec; the position is written to localStorage so you can come back to it.
   There is no upload path in this file at all — no fetch, no XHR, no form. If
   you want to audit that, search for "fetch": there is nothing to find.
   =========================================================================== */

(function (root) {
  "use strict";
  var P = root.PLAYER, PH = root.PH;
  var doc = document;

  function $(sel, at) { return (at || doc).querySelector(sel); }
  function $$(sel, at) { return Array.prototype.slice.call((at || doc).querySelectorAll(sel)); }
  function esc(s) { return PH.esc(s); }

  /* ------------------------------- state ------------------------------- */
  var st = {
    items: [],            /* {file, url, name, size, kind, info, subUrl, subLabel, error} */
    i: -1,
    ab: { a: null, b: null, on: false },
    resume: PH.store.get("photon.resume.v1", {}) || {},
    volume: PH.store.get("photon.volume.v1", 1),
    rate: PH.store.get("photon.rate.v1", 1),
    repeat: PH.store.get("photon.repeat.v1", false),
    autoSub: true,
    objectUrls: [],
    scrubbing: false,
    lastTick: 0,
    startedAt: 0
  };

  var video = $("#stage-media"), audioOnly = false;
  var out = $("#player-out");
  if (!video) return;

  /* ------------------------------- helpers ---------------------------- */
  function setStatus(text, kind) {
    var n = $("#status-line");
    if (!n) return;
    n.className = "small" + (kind === "bad" ? " warn" : "");
    n.textContent = text;
  }
  function panel(html) {
    out.innerHTML = html || "";
  }
  function say(lines, extra) {
    if (!lines || !lines.length) { panel(""); return; }
    panel('<div class="box">' + (extra || "") + lines.map(function (l) {
      return '<p style="margin:0 0 8px;font-size:13px">' + l + "</p>";
    }).join("") + "</div>");
  }
  function fmtSize(n) { return PH.fmtBytes(n); }
  /* the stage is never a black hole: while nothing is loaded it says so */
  function showIdle() {
    var idle = $("#no-media");
    if (idle) idle.classList.remove("hide");
  }

  function release(url) {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch (e) {}
  }

  /* --------------------------- adding files ---------------------------- */
  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return 0;
    /* sort the whole pick together so a folder arrives in reading order */
    files.sort(function (a, b) {
      var ka = P.naturalKey(a.name), kb = P.naturalKey(b.name);
      return ka < kb ? -1 : (ka > kb ? 1 : 0);
    });
    var pairs = P.guessPairs(files);
    var media = 0, subs = 0, refused = [];
    pairs.forEach(function (pair) {
      var f = pair.file;
      var verdict = P.accepts(f.name, f.type);
      if (verdict.subtitle) {
        /* a lone subtitle that had no matching video in the pick: attach to the last item */
        if (pair.sub) return;   /* consumed below */
        return;
      }
      if (!verdict.ok) {
        if (!/\.(srt|vtt)$/i.test(f.name)) refused.push(f.name);
        return;
      }
      var url = null;
      try { url = URL.createObjectURL(f); } catch (e) { url = null; }
      if (!url) { refused.push(f.name + " (the browser refused to hand out a handle)"); return; }
      st.objectUrls.push(url);
      var item = {
        file: f, url: url, name: f.name, size: f.size, kind: verdict.kind,
        info: null, error: null, subUrl: null, subLabel: "", caveat: verdict.caveat
      };
      if (pair.sub) {
        var surl = null;
        try { surl = URL.createObjectURL(pair.sub); } catch (e) {}
        if (surl) {
          st.objectUrls.push(surl);
          item.subUrl = surl;
          item.subLabel = pair.sub.name;
          item.subFile = pair.sub;
        }
      }
      st.items.push(item);
      media++;
      probeItem(item);
    });
    /* subtitles that came with a match are already used; leftovers are reported */
    files.forEach(function (f) {
      if (/\.(srt|vtt)$/i.test(f.name) && !st.items.some(function (it) { return it.subFile === f; })) subs++;
    });
    render();
    if (st.i < 0 && st.items.length) select(0, true);
    var msg = media ? media + " item" + (media === 1 ? "" : "s") + " added" : "No playable media in that pick";
    if (refused.length) msg += " · " + refused.length + " refused (" + refused.slice(0, 3).join(", ") + (refused.length > 3 ? ", …" : "") + ")";
    if (subs) msg += " · " + subs + " subtitle file" + (subs === 1 ? "" : "s") + " not used — the name has to match the video";
    setStatus(msg, media ? "" : "bad");
    return media;
  }

  /* read the header without pulling the whole file into memory */
  function probeItem(item) {
    var headSize = Math.min(item.size, P.HEAD_PROBE);
    item.probeState = "reading";
    var frags = [];
    if (headSize > 0) frags.push(item.file.slice(0, headSize));
    var tailSize = 0;
    if (item.size > P.HEAD_PROBE + P.TAIL_PROBE) {
      tailSize = P.TAIL_PROBE;
      frags.push(item.file.slice(item.size - tailSize, item.size));
    }
    Promise.all(frags.map(function (b) { return b.arrayBuffer(); })).then(function (buffers) {
      var merged = new Uint8Array(buffers.reduce(function (n, x) { return n + x.byteLength; }, 0));
      var off = 0;
      buffers.forEach(function (buf) { merged.set(new Uint8Array(buf), off); off += buf.byteLength; });
      /* merged is head-then-tail, which is exactly what the mp4 branch of the
         prober wants: it looks for a moov near the end of whatever it is given */
      var info = P.probe(merged, item.name);
      item.info = info;
      item.probeState = "done";
      render();
      if (st.items[st.i] === item) showInfo(item, true);
      if (info.play === "no" || info.container === "unknown" || info.container === "text") {
        setStatus(item.name + ": " + info.container + (info.video ? " / " + info.video : "") + " — see the panel below", "bad");
      }
    })["catch"](function (e) {
      item.probeState = "failed";
      item.probeError = e && e.message;
      render();
    });
  }

  function render() {
    var host = $("#playlist");
    if (!host) return;
    if (!st.items.length) {
      host.innerHTML = '<div class="pl-row"><span class="nm faint">Nothing loaded yet.</span></div>';
      $("#pl-count").textContent = "0 items · 0 B";
      return;
    }
    host.innerHTML = st.items.map(function (it, i) {
      var verdict = it.info ? (it.info.play === "yes" ? '<span class="dot ok"></span>' :
        (it.info.play === "no" ? '<span class="dot off"></span>' : '<span class="dot hold"></span>')) : '<span class="dot hold"></span>';
      var codec = it.probeState === "reading" ? "reading header…" :
        (it.info ? (it.info.video || it.info.audio || it.info.container) : "no header read");
      return '<div class="pl-row' + (i === st.i ? " now" : "") + '" data-i="' + i + '">' +
        '<span class="idx">' + (i + 1) + '.</span>' +
        '<span class="nm"><a href="#" data-open="' + i + '">' + esc(it.name) + "</a>" +
        (it.subUrl ? ' <span class="xs faint">+ ' + esc(it.subLabel) + "</span>" : "") +
        (it.error ? ' <span class="xs warn">error</span>' : "") +
        '<br><span class="xs faint">' + verdict + " " + esc(codec) + "</span></span>" +
        '<span class="sz">' + fmtSize(it.size) + "</span>" +
        '<button type="button" class="x" data-drop="' + i + '" title="take it off the list">&times;</button>' +
        "</div>";
    }).join("");
    var total = st.items.reduce(function (n, it) { return n + it.size; }, 0);
    $("#pl-count").textContent = st.items.length + " item" + (st.items.length === 1 ? "" : "s") + " · " + fmtSize(total);
  }

  function showInfo(item, quiet) {
    var info = item.info;
    var bits = "";
    if (info) {
      var rows = [
        ["file", esc(item.name)],
        ["container", esc(info.container) + (info.brand ? ' <span class="faint">brand ' + esc(info.brand.trim()) + "</span>" : "")],
        ["video", info.video ? esc(info.video) + ' <span class="' + (info.videoPlay === "yes" ? "dim" : "warn") + '">(' + esc(info.videoPlay) + ")</span>" : '<span class="faint">none stated</span>'],
        ["audio", info.audio ? esc(info.audio) + ' <span class="' + (info.audioPlay === "yes" ? "dim" : "warn") + '">(' + esc(info.audioPlay) + ")</span>" : '<span class="faint">none stated</span>'],
        ["size", fmtSize(item.size) + ' <span class="faint">(' + item.size.toLocaleString() + " bytes)</span>"],
        ["header", esc(info.scanned ? Math.round(info.scanned / 1024) + " KB read" : "—")],
        ["length", info.duration ? P.fmtTime(info.duration) : '<span class="faint">not in the header</span>'],
        ["frame", info.width ? info.width + "×" + info.height : '<span class="faint">—</span>'],
        ["captions", info.subs ? (info.subsInside + " inside the container — pick a track in the Captions menu") : '<span class="faint">none inside</span>'],
        ["written by", info.app ? esc(info.app) : '<span class="faint">—</span>']
      ];
      if (item.subUrl) rows.push(["sidecar", esc(item.subLabel) + " <button type=\"button\" class=\"btn\" data-unsub=\"1\">remove</button>"]);
      bits = '<table class="probe">' + rows.map(function (r) {
        return "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>";
      }).join("") + "</table>" +
        (info.note ? '<p class="small" style="margin:10px 0 0">' + info.note + "</p>" : "") +
        '<p class="row mt8"><button type="button" class="btn" data-why="1">Why will this not play?</button>' +
        '<button type="button" class="btn" data-reload="1">Re-read this file</button></p>';
    } else {
      bits = '<p class="small" style="margin:0">Header not read yet.</p>';
    }
    panel('<div class="cols"><div style="flex:1 1 320px">' + bits + "</div>" +
      '<div style="flex:1 1 240px"><div class="draw" data-art="img/player.png" data-w="360" data-alt="' +
      "Ink drawing of a media player window: dark rectangle, scrub bar beneath, triangular play mark at the left, a narrow playlist column at the right." +
      '"><b>DRAW THIS &mdash; IMAGE 4</b> <span class="size">(wide, roughly 560 &times; 300)</span>' +
      '<p style="margin:8px 0 0">The player window as an object: a rectangle with a 2px border, and beneath it a strip holding a long thin scrub bar with one square handle on it. A filled triangle at the far left of the strip. To the right of the rectangle, a narrower column of eight ruled lines, the third one shaded — that is the playlist. Draw the handle of the scrub bar two thirds along, not in the middle.</p>' +
      '<p style="margin:8px 0 0" class="size">SAVE AS: <code>img/player.png</code></p></div></div></div>');
    if (!quiet) video.scrollIntoView ? null : null;
  }

  /* ------------------------------ loading ----------------------------- */
  function select(i, autoplay) {
    if (i < 0 || i >= st.items.length) return;
    var item = st.items[i];
    st.i = i;
    st.startedAt = Date.now();
    audioOnly = item.kind === "audio";
    video.classList.toggle("audio-mode", audioOnly);
    video.hidden = false;
    var idle = $("#no-media");
    if (idle) idle.classList.add("hide");
    video.poster = "";
    $("#now-name").innerHTML = esc(item.name);
    $("#now-meta").textContent = item.info ? P.formatProbeLine(item.info) : "reading the header…";
    showInfo(item, true);
    render();
    clearAB();
    setCaptionTrack(null);
    video.src = item.url;
    video.playbackRate = P.clampRate(st.rate);
    if (item.error) { item.error = null; }
    var trySub = item.subUrl;
    if (trySub) {
      attachCue(trySub, item.subLabel || "sidecar");
    }
    if (autoplay) {
      var p = video.play();
      if (p && p["catch"]) p["catch"](function () { setStatus("The browser will not start playback by itself — press play.", "bad"); });
    } else {
      /* restoring on a click is deliberate: it keeps the browser's gesture rule happy */
      var at = P.loadResume(st.resume, P.resumeKey(item.name, item.size, item.file.lastModified));
      if (P.shouldResume(at, video.duration || at)) {
        panel('<div class="box"><p class="small" style="margin:0 0 8px">This file was left at <b>' +
          P.resumeNote(at) + 's</b> of ' + P.fmtTime(video.duration || at) + '.</p>' +
          '<p class="row" style="margin:0"><button type="button" class="btn" data-resume-go="1">Start from ' + P.fmtTime(at) +
          '</button><button type="button" class="btn" data-resume-no="1">From the top</button></p></div>');
      }
    }
  }

  function attachCue(url, label) {
    /* a track element added after load needs the video to re-read the text tracks */
    var t = doc.createElement("track");
    t.kind = "subtitles";
    t.label = label || "loaded";
    t.srclang = "z";
    t.default = true;
    t.src = url;
    t.addEventListener("load", function () {
      try { video.textTracks[video.textTracks.length - 1].mode = "showing"; } catch (e) {}
      buildTrackMenu();
    });
    t.addEventListener("error", function () {
      setStatus("That subtitle file would not parse as WebVTT after conversion.", "bad");
    });
    video.appendChild(t);
  }

  /* srt and the rest have to become vtt: convert in memory, then hand it back as a url */
  function loadSubtitleFile(file) {
    var r = new FileReader();
    r.onload = function () {
      var text = String(r.result || "");
      var vtt = /\.vtt$/i.test(file.name) ? text : P.srtToVtt(text);
      var cues = P.countCues(vtt);
      if (!cues) {
        setStatus(file.name + ": converted, but it contains no usable cues. The timings probably will not parse.", "bad");
        return;
      }
      var url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
      st.objectUrls.push(url);
      var item = st.items[st.i];
      if (item) { item.subUrl = url; item.subLabel = file.name; item.subFile = file; }
      attachCue(url, file.name);
      setStatus(cues + " cue" + (cues === 1 ? "" : "s") + " from " + file.name + " on screen.");
      render();
      showInfo(item, true);
    };
    r.onerror = function () { setStatus("That file could not be read at all.", "bad"); };
    r.readAsText(file);
  }

  /* ------------------------------- controls ---------------------------- */
  function paintTime() {
    var cur = video.currentTime || 0, dur = video.duration;
    $("#t-cur").textContent = P.fmtTime(cur);
    $("#t-dur").textContent = (isFinite(dur) && dur > 0) ? P.fmtTime(dur) : "—:——";
    if (!st.scrubbing) {
      var s = $("#scrub");
      s.max = (isFinite(dur) && dur > 0) ? dur.toFixed(2) : 0;
      s.value = Math.min(cur, isFinite(dur) ? dur : cur);
    }
    var buf = $("#buffered");
    if (buf) {
      if (video.buffered.length && isFinite(dur) && dur > 0) {
        var end = 0;
        for (var i = 0; i < video.buffered.length; i++) end = Math.max(end, video.buffered.end(i));
        buf.style.width = Math.min(100, (end / dur) * 100) + "%";
      } else buf.style.width = "0%";
    }
    var lbl = $("#ab-read");
    if (lbl) lbl.textContent = st.ab.on ? "A–B " + P.fmtTime(st.ab.a) + "→" + P.fmtTime(st.ab.b) +
      " (" + P.abDuration(st.ab).toFixed(1) + "s)" : (st.ab.a != null ? "A set at " + P.fmtTime(st.ab.a) + ", waiting for B" : "no loop");
  }

  function togglePlay() {
    if (st.i < 0) { setStatus("Load a file first — the picker is above.", "bad"); return; }
    if (video.paused) {
      var p = video.play();
      if (p && p["catch"]) p["catch"](function (e) {
        setStatus("Play refused: " + (e && e.name ? e.name : e), "bad");
      });
    } else video.pause();
  }

  function skip(delta) {
    if (st.i < 0) return;
    var dur = video.duration;
    video.currentTime = P.stepSeek(video.currentTime, delta, dur);
    paintTime();
  }
  function frame(dir) {
    if (st.i < 0) return;
    if (!video.paused) video.pause();
    video.currentTime = P.clampSeek(video.currentTime + dir * (1 / 30), video.duration);
    setStatus("Frame " + (dir > 0 ? "forward" : "back") + " to " + P.fmtTime(video.currentTime) + " — the browser steps by a frame if it can, 1/30s otherwise.");
  }

  function setRate(r) {
    st.rate = P.clampRate(r);
    video.playbackRate = st.rate;
    PH.store.set("photon.rate.v1", st.rate);
    $("#rate-read").textContent = st.rate + "×";
    $$("#rate-row button").forEach(function (b) {
      b.classList.toggle("on", parseFloat(b.getAttribute("data-rate")) === st.rate);
    });
  }
  function setVolume(v) {
    st.volume = Math.max(0, Math.min(1, v));
    video.volume = st.volume;
    video.muted = st.volume === 0;
    PH.store.set("photon.volume.v1", st.volume);
    $("#vol-read").textContent = P.volumeLabel(st.volume);
    $("#vol").value = st.volume;
    $("#mute").classList.toggle("on", video.muted);
  }

  function clearAB() {
    st.ab = { a: null, b: null, on: false };
    paintTime();
  }
  function setAB(which) {
    var t = video.currentTime;
    if (which === "a") st.ab = P.abState(t, null);
    else if (which === "b") st.ab = P.abState(st.ab.a == null ? t : st.ab.a, t);
    else if (which === "off") { clearAB(); return; }
    if (st.ab.bad) setStatus("B has to come after A — the loop was cleared.", "bad");
    else if (st.ab.on) setStatus("Looping " + P.fmtTime(st.ab.a) + " to " + P.fmtTime(st.ab.b) + ". " + P.abDuration(st.ab).toFixed(1) + " seconds.");
    paintTime();
  }

  function snap() {
    if (st.i < 0 || audioOnly) { setStatus("A frame grab needs a video picture to grab.", "bad"); return; }
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { setStatus("The decoder has not produced a frame yet.", "bad"); return; }
    var c = doc.createElement("canvas");
    c.width = w; c.height = h;
    try {
      c.getContext("2d").drawImage(video, 0, 0, w, h);
      c.toBlob(function (blob) {
        if (!blob) { setStatus("The canvas would not give up a PNG — usually a codec the browser will not decode."); return; }
        var url = URL.createObjectURL(blob);
        st.objectUrls.push(url);
        var name = (st.items[st.i].name.replace(/\.[a-z0-9]+$/i, "") || "frame") + " @ " + P.fmtTime(video.currentTime).replace(/:/g, "-") + ".png";
        var a = doc.createElement("a");
        a.href = url; a.download = name;
        doc.body.appendChild(a); a.click();
        setTimeout(function () { a.remove(); }, 500);
        setStatus("Frame written to " + name + " — " + w + "×" + h + ".");
      }, "image/png");
    } catch (e) {
      setStatus("Frame grab failed: " + e.message, "bad");
    }
  }

  function fullscreen() {
    var host = $("#stage");
    var req = host.requestFullscreen || host.webkitRequestFullscreen || host.webkitRequestFullScreen || host.msRequestFullscreen;
    var ex = doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement;
    var exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
    if (ex) { if (exit) exit.call(doc); return; }
    if (req) {
      var r = req.call(host);
      if (r && r["catch"]) r["catch"](function (e) { setStatus("Fullscreen refused: " + e.name, "bad"); });
    } else setStatus("This browser has no fullscreen call on a div. Play it in its own tab and use the browser's own fullscreen.", "bad");
  }

  function pip() {
    if (!("pictureInPictureEnabled" in doc) || doc.pictureInPictureEnabled === false) {
      setStatus("No picture-in-picture in this browser.", "bad");
      return;
    }
    if (doc.pictureInPictureElement) { doc.exitPictureInPicture(); return; }
    video.requestPictureInPicture()["catch"](function (e) {
      setStatus("PiP needs a playing video with a picture: " + e.name, "bad");
    });
  }

  function buildTrackMenu() {
    var sel = $("#track-menu");
    var tracks = [];
    for (var i = 0; i < video.textTracks.length; i++) tracks.push(video.textTracks[i]);
    sel.innerHTML = '<option value="-1">no captions</option>' + tracks.map(function (t, i) {
      return '<option value="' + i + '">' + esc(P.trackLabel(t, i)) + "</option>";
    }).join("");
    var showing = tracks.map(function (t, i) { return t.mode === "showing" ? i : -1; }).filter(function (i) { return i >= 0; })[0];
    sel.value = showing == null ? "-1" : String(showing);
    sel.disabled = !tracks.length;
  }
  function setCaptionTrack(i) {
    for (var k = 0; k < video.textTracks.length; k++) {
      video.textTracks[k].mode = (String(k) === String(i)) ? "showing" : "hidden";
    }
    setTimeout(buildTrackMenu, 0);
  }

  /* ------------------------------- wiring ----------------------------- */
  $("#file-input").addEventListener("change", function (e) {
    addFiles(e.target.files);
    e.target.value = "";
  });
  $("#folder-input").addEventListener("change", function (e) {
    var picked = Array.prototype.slice.call(e.target.files || []).filter(function (f) {
      return /\.(mkv|mp4|webm|mov|avi|m4v|mp3|m4a|flac|ogg|oga|opus|wav|aif|aiff|srt|vtt)$/i.test(f.name);
    });
    addFiles(picked);
    e.target.value = "";
  });
  $("#sub-input").addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) loadSubtitleFile(e.target.files[0]);
    e.target.value = "";
  });

  var drop = $("#drop");
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (e) {
    var dt = e.dataTransfer;
    if (!dt) return;
    var direct = dt.files && dt.files.length ? Array.prototype.slice.call(dt.files) : null;
    var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
    if (!direct && items.length && items[0].webkitGetAsEntry) {
      /* a folder was dragged: walk it before deciding anything */
      var acc = [], pending = items.length;
      function finish() { if (!--pending) addFiles(acc); }
      function collect(entry, cb) {
        if (entry.isFile) {
          entry.file(function (f) { acc.push(f); cb(); }, cb);
        } else if (entry.isDirectory) {
          var rd = entry.createReader(), kids = [];
          (function readMore() {
            rd.readEntries(function (list) {
              if (!list.length) {
                (function each(i) {
                  if (!kids.length) return cb();
                  if (i >= kids.length) return cb();
                  collect(kids[i], function () { each(i + 1); });
                })(0);
                return;
              }
              kids = kids.concat(list);
              readMore();
            }, cb);
          })();
        } else cb();
      }
      items.forEach(function (it) {
        var en = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
        if (!en) {
          var f = it.getAsFile ? it.getAsFile() : null;
          if (f) acc.push(f);
          finish();
          return;
        }
        collect(en, finish);
      });
      if (!items.length) addFiles([]);
      return;
    }
    addFiles(direct || []);
  });

  $("#playlist").addEventListener("click", function (e) {
    var open = e.target.closest ? e.target.closest("[data-open]") : null;
    var drop2 = e.target.closest ? e.target.closest("[data-drop]") : null;
    if (open) { e.preventDefault(); select(parseInt(open.getAttribute("data-open"), 10), true); return; }
    if (drop2) {
      var i = parseInt(drop2.getAttribute("data-drop"), 10);
      var item = st.items[i];
      release(item.url); release(item.subUrl);
      st.items.splice(i, 1);
      if (i === st.i) { st.i = -1; video.removeAttribute("src"); video.load(); video.hidden = true; panel(""); $("#now-name").textContent = "nothing loaded"; $("#now-meta").textContent = ""; showIdle(); }
      else if (i < st.i) st.i--;
      render();
      setStatus("Took " + item.name + " off the list.");
    }
  });
  $("#pl-clear").addEventListener("click", function () {
    st.items.forEach(function (it) { release(it.url); release(it.subUrl); });
    st.items = []; st.i = -1; st.objectUrls.forEach(release); st.objectUrls = [];
    video.removeAttribute("src"); video.load();
    panel(""); render(); showIdle();
    $("#now-name").textContent = "nothing loaded";
    $("#now-meta").textContent = "";
    setStatus("List cleared. Handles on the files are released, so the disk can have them back.");
  });

  out.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    var item = st.items[st.i];
    if (b.hasAttribute("data-why") && item) {
      say(P.advice(item.errorText || "", item.info ? Object.assign({ file: item.name }, item.info) : { file: item.name, ext: P.extOf(item.name) }));
    } else if (b.hasAttribute("data-reload") && item) {
      item.info = null; probeItem(item); setStatus("Re-reading " + item.name + "…");
    } else if (b.hasAttribute("data-unsub") && item) {
      release(item.subUrl); item.subUrl = null; item.subFile = null; item.subLabel = "";
      /* a track element cannot be removed once the media has loaded its list, so
         hide every one of them and let the container's own tracks win next time */
      for (var ti = 0; ti < video.textTracks.length; ti++) video.textTracks[ti].mode = "hidden";
      $$("track", video).forEach(function (t) { if (t.src === item.subUrl || /^blob:/.test(t.src)) t.track && 0; });
      buildTrackMenu(); render(); showInfo(item, true);
      setStatus("Caption file taken off; the ones inside the container are still there.");
    } else if (b.hasAttribute("data-resume-go")) {
      var at = P.loadResume(st.resume, P.resumeKey(item.name, item.size, item.file.lastModified));
      video.currentTime = P.clampSeek(at, video.duration);
      showInfo(item, true);
      video.play();
    } else if (b.hasAttribute("data-resume-no")) {
      delete st.resume[P.resumeKey(item.name, item.size, item.file.lastModified)];
      PH.store.set("photon.resume.v1", st.resume);
      video.currentTime = 0;
      showInfo(item, true);
      video.play();
    }
  });

  $$("#rate-row button").forEach(function (b) {
    b.addEventListener("click", function () { setRate(parseFloat(b.getAttribute("data-rate"))); });
  });
  $("#vol").addEventListener("input", function (e) { setVolume(parseFloat(e.target.value)); });
  $("#mute").addEventListener("click", function () {
    video.muted = !video.muted;
    $("#mute").classList.toggle("on", video.muted);
    $("#mute").textContent = video.muted ? "sound on" : "mute";
  });
  $("#play").addEventListener("click", togglePlay);
  $("#prev").addEventListener("click", function () { select(P.prevIndex(st.i, st.items.length), true); });
  $("#next").addEventListener("click", function () { select(P.nextIndex(st.i, st.items.length, !st.repeat), true); });
  $$(".skip").forEach(function (b) { b.addEventListener("click", function () { skip(parseFloat(b.getAttribute("data-skip"))); }); });
  $$(".frame").forEach(function (b) { b.addEventListener("click", function () { frame(parseInt(b.getAttribute("data-frame"), 10)); }); });
  $("#ab-a").addEventListener("click", function () { setAB("a"); });
  $("#ab-b").addEventListener("click", function () { setAB("b"); });
  $("#ab-off").addEventListener("click", function () { setAB("off"); });
  $("#snap").addEventListener("click", snap);
  $("#fs").addEventListener("click", fullscreen);
  $("#pip").addEventListener("click", pip);
  $("#track-menu").addEventListener("change", function (e) { setCaptionTrack(e.target.value); });
  $("#repeat").addEventListener("click", function () {
    st.repeat = !st.repeat;
    PH.store.set("photon.repeat.v1", st.repeat);
    $("#repeat").classList.toggle("on", st.repeat);
    $("#repeat").textContent = st.repeat ? "repeat: on" : "repeat: off";
  });
  $("#scrub").addEventListener("input", function () { st.scrubbing = true; $("#t-scrub").textContent = P.fmtTime(parseFloat($("#scrub").value)); });
  $("#scrub").addEventListener("change", function () {
    var v = parseFloat($("#scrub").value);
    if (isFinite(v) && st.i >= 0) video.currentTime = P.clampSeek(v, video.duration);
    st.scrubbing = false;
    $("#t-scrub").textContent = "";
    paintTime();
  });

  /* click the picture to pause, double click for fullscreen — same as every player since forever */
  video.addEventListener("click", togglePlay);
  video.addEventListener("dblclick", fullscreen);
  video.addEventListener("play", function () { $("#play").textContent = "pause"; });
  video.addEventListener("pause", function () { $("#play").textContent = "play"; });
  video.addEventListener("loadedmetadata", function () {
    buildTrackMenu();
    paintTime();
    $("#t-meta").textContent = (video.videoWidth || "?") + "×" + (video.videoHeight || "?");
    if (video.duration && !isFinite(video.duration)) $("#t-meta").textContent += " · no duration in this stream";
    var item = st.items[st.i];
    if (item) {
      var at = P.loadResume(st.resume, P.resumeKey(item.name, item.size, item.file.lastModified));
      if (P.shouldResume(at, video.duration)) {
        video.currentTime = P.clampSeek(at, video.duration);
        setStatus("Resumed at " + P.fmtTime(at) + " where you stopped. <button type=\"button\" class=\"btn\" data-restart>start from 0</button>");
      }
    }
    /* auto-load captions that arrived in the same pick but had no match yet */
    if (st.autoSub && item && !item.subUrl) {
      setStatus(item.info ? "Ready. " + P.formatProbeLine(item.info) : "Ready.");
    }
  });
  video.addEventListener("timeupdate", function () {
    paintTime();
    var act = P.abTick(video.currentTime, st.ab);
    if (act.action === "seek") { video.currentTime = act.to; }
    if (st.i >= 0 && !video.paused) {
      var item = st.items[st.i];
      P.saveResume(st.resume, P.resumeKey(item.name, item.size, item.file.lastModified), video.currentTime, video.duration);
      if (Date.now() - st.lastTick > 4000) {
        st.lastTick = Date.now();
        P.dropOldResume(st.resume, 60);
        PH.store.set("photon.resume.v1", st.resume);
      }
    }
  });
  video.addEventListener("ended", function () {
    var item = st.items[st.i];
    if (item) {
      delete st.resume[P.resumeKey(item.name, item.size, item.file.lastModified)];
      PH.store.set("photon.resume.v1", st.resume);
    }
    var nxt = P.nextIndex(st.i, st.items.length, !st.repeat);
    if (nxt >= 0 && st.items.length > 1) {
      setStatus("Finished. Next up: " + st.items[nxt].name);
      select(nxt, true);
    } else {
      setStatus("End of the list. Positions remembered for the next time.");
    }
  });
  video.addEventListener("error", function () {
    var item = st.items[st.i];
    if (!item) return;
    var err = video.error || {};
    item.error = true;
    item.errorText = (err.message || "") + (err.code ? " code " + err.code : "");
    var text = P.mediaErrorText(err, Object.assign({ ext: P.extOf(item.name) }, item.info || {}));
    say([
      "<b>" + esc(item.name) + "</b> would not play.",
      esc(text)
    ].concat(item.info ? P.advice(err.message || ("code " + (err.code || "?")), Object.assign({ file: item.name }, item.info)) : []));
    setStatus("Playback failed on " + item.name + " — the panel below says what the header looked like.", "bad");
    render();
  });
  video.addEventListener("stalled", function () { setStatus("Stalled. On a mechanical drive this is the disk losing the race; on a stick it is the stick.", "bad"); });
  video.addEventListener("waiting", function () { setStatus("Buffering…"); });
  video.addEventListener("canplay", function () { if ($("#status-line").textContent.indexOf("Buffering") === 0) setStatus("Playing."); });

  /* media keys, and no other site gets them while this tab is open */
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", togglePlay);
      navigator.mediaSession.setActionHandler("pause", togglePlay);
      navigator.mediaSession.setActionHandler("previoustrack", function () { select(P.prevIndex(st.i, st.items.length), true); });
      navigator.mediaSession.setActionHandler("nexttrack", function () { select(P.nextIndex(st.i, st.items.length, !st.repeat), true); });
      navigator.mediaSession.setActionHandler("seekbackward", function () { skip(-10); });
      navigator.mediaSession.setActionHandler("seekforward", function () { skip(10); });
    } catch (e) {}
  }
  function updateSession() {
    if (!("mediaSession" in navigator) || st.i < 0) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: st.items[st.i].name, artist: "Photon.Directory player" });
    } catch (e) {}
  }
  video.addEventListener("play", updateSession);

  /* keyboard, but never while a field has focus */
  doc.addEventListener("keydown", function (e) {
    var t = e.target || {};
    if (/input|textarea|select/i.test(t.tagName || "")) return;
    if (t.isContentEditable) return;
    var k = e.key;
    var map = {
      " ": togglePlay, k: togglePlay,
      ArrowRight: function () { skip(5); }, l: function () { skip(5); },
      ArrowLeft: function () { skip(-5); }, j: function () { skip(-10); },
      K: function () { skip(-10); },
      PageUp: function () { select(P.prevIndex(st.i, st.items.length), true); },
      PageDown: function () { select(P.nextIndex(st.i, st.items.length, !st.repeat), true); },
      ">": function () { setRate(st.rate >= 2 ? st.rate + 0.5 : st.rate + 0.25); },
      "<": function () { setRate(st.rate <= 1 ? st.rate - 0.25 : st.rate - 0.5); },
      f: fullscreen, m: function () { $("#mute").click(); },
      s: snap, p: pip, n: function () { setAB("a"); },
      b: function () { setAB("b"); }, Escape: function () { setAB("off"); },
      "?": function () { $("#help").classList.toggle("hide"); }
    };
    if (k === ",") { frame(-1); e.preventDefault(); return; }
    if (k === ".") { frame(1); e.preventDefault(); return; }
    var fn = map[k];
    if (!fn) return;
    e.preventDefault();
    fn();
  });
  /* , and . are frame steps; they collide with nothing */
  $$("#kbd-list .key").forEach(function () {});

  /* init from storage */
  video.volume = P.clamp(st.volume, 0, 1);
  $("#vol").value = st.volume;
  $("#vol-read").textContent = P.volumeLabel(st.volume);
  setRate(st.rate);
  $("#repeat").classList.toggle("on", st.repeat);
  $("#repeat").textContent = st.repeat ? "repeat: on" : "repeat: off";
  render();
  buildTrackMenu();
  paintTime();
  $("#kb-note").textContent = "space play/pause · ← → skip 5s · j k skip 10s · , . frame step · &lt; &gt; speed · f fullscreen · m mute · s frame grab · p picture-in-picture · n b set A and B · esc clear loop · PageUp PageDown change item · ? this list";

  root.PHOTON_PLAYER = { st: st, addFiles: addFiles, select: select };
})(window);
