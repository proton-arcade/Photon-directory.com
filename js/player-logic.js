/* ===========================================================================
   player-logic.js — the thinking half of the media player.

   A browser will play some .mkv files and refuse others, and what decides it is
   the codec inside, not the extension on the front. So instead of showing
   "error" and shrugging, the player reads the actual header bytes: EBML for
   Matroska and WebM, ISO boxes for MP4 and MOV, and the AVI fourcc scan. That is
   what lets the page say "this is an Xvid stream, no browser ships a decoder for
   it, here is the ffmpeg line" rather than guessing.

   Nothing in this file touches a dom, a file picker or a network, so all of it
   can be tested with a few bytes in node. See tools/test-logic.js.
   =========================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.PLAYER = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var HEAD_PROBE = 3 * 1024 * 1024;    /* bytes read off the front to decide */
  var TAIL_PROBE = 1 * 1024 * 1024;   /* an mp4's moov box is often at the end */

  /* ------------------------------- small maths ---------------------------- */
  function clamp(v, lo, hi) {
    v = Number(v);
    if (!isFinite(v)) return lo;
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function num(v, fallback) { v = Number(v); return isFinite(v) ? v : fallback; }

  function fmtTime(sec) {
    sec = Number(sec);
    if (!isFinite(sec)) return "—";
    if (sec < 0) sec = 0;
    var s = Math.floor(sec);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return h ? h + ":" + pad(m) + ":" + pad(ss) : m + ":" + pad(ss);
  }

  /* "01:02:03,400" | "1:02.5" | "95" -> seconds */
  function hmsToSec(str) {
    var t = String(str == null ? "" : str).trim().replace(/,/, ".");
    if (!t) return NaN;
    var parts = t.split(":");
    var vals = [];
    for (var i = 0; i < parts.length; i++) {
      if (/^\s*[-+]/.test(parts[i])) return NaN;      /* a negative time field is a broken file */
      var v = Number(parts[i]);
      if (!isFinite(v) || v < 0) return NaN;
      vals.push(v);
    }
    if (vals.length === 3) return vals[0] * 3600 + vals[1] * 60 + vals[2];
    if (vals.length === 2) return vals[0] * 60 + vals[1];
    if (vals.length === 1) return vals[0];
    return NaN;
  }

  function readUInt(b, o, n) {
    var v = 0;
    for (var i = 0; i < n; i++) {
      var c = b[o + i];
      if (c == null) return NaN;
      v = v * 256 + c;
    }
    return v;
  }
  function readUInt64(b, o) {
    return readUInt(b, o, 4) * 4294967296 + readUInt(b, o + 4, 4);
  }
  function ascii(b, o, n) {
    var out = "";
    for (var i = 0; i < n; i++) {
      var c = b[o + i];
      if (c == null || c === 0) break;
      out += String.fromCharCode(c);
    }
    return out;
  }
  function fourcc(b, o) { return ascii(b, o, 4); }
  function floats(b, o, wide) {
    try {
      var dv = new DataView(b.buffer || b, (b.byteOffset || 0) + o);
      return wide ? dv.getFloat64(0, false) : dv.getFloat32(0, false);
    } catch (e) { return NaN; }
  }

  /* ---------------------------- what the page will take ------------------- */
  var VIDEO_EXT = ("mkv webm mp4 m4v mov avi divx flv vob ogm ogv mts m2ts ts " +
    "mpg mpeg mpe m2v ts mxf mpegv 3gp 3g2 f4v rm rmv m4v").split(" ");
  var AUDIO_EXT = "mp3 m4a aac ogg oga opus flac wav wave aif aiff aifc weba mka m4b amr mid midi".split(" ");
  var SUB_EXT = "srt vtt ass ssa sub subvtt txt".split(" ");
  /* containers the header may be fine but the browser's demuxer is not */
  var RISKY_EXT = "avi wmv asf flv vob mpg mpeg mts m2ts ts ogm rm rmv divx mxf m2v".split(" ");

  function extOf(name) {
    var m = /\.([a-z0-9]{1,6})$/i.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }

  /* returns {ok, kind, ext, subtitle, caveat, label} */
  function accepts(name, mime) {
    var ext = extOf(name);
    var kind = null;
    if (/^video\//i.test(mime || "")) kind = "video";
    else if (/^audio\//i.test(mime || "")) kind = "audio";
    if (!kind && AUDIO_EXT.indexOf(ext) !== -1) kind = "audio";
    if (!kind && VIDEO_EXT.indexOf(ext) !== -1) kind = "video";
    var sub = SUB_EXT.indexOf(ext) !== -1 || /text\/vtt|x-subrip|subrip|subtitle|vtt/i.test(mime || "");
    if (kind === "audio" && ext === "txt") kind = null;
    return {
      ok: !!kind,
      media: !!kind,
      kind: kind,
      ext: ext,
      subtitle: !kind && sub,
      caveat: RISKY_EXT.indexOf(ext) !== -1,
      label: kind === "audio" ? "audio" : (kind === "video" ? "video" : (sub ? "captions" : "not media"))
    };
  }

  /* ------------------------- codecs, and who can play them --------------- */
  /* play: yes = any modern browser · mostly = most, some gaps ·
     device = needs a hardware HEVC block · chrome = Chromium only ·
     no = nobody ships it · unknown = header did not say */
  var CODECS = {
    "V_MPEG4/ISO/AVC": ["H.264 / AVC", "yes"],
    "V_MPEG4/ISO/ASP": ["MPEG-4 Part 2", "no"],
    "V_MPEG4/ISO/AP": ["MPEG-4 Part 2", "no"],
    "V_MPEG4/XVID": ["Xvid", "no"],
    "V_MPEG4/DIVX": ["DivX", "no"],
    "V_MS/VFW/FOURCC": ["a VfW codec (DivX / Xvid / MJPEG class)", "no"],
    "V_MPEG2": ["MPEG-2", "no"],
    "V_MPEG1": ["MPEG-1", "no"],
    "V_MPEGH/ISO/HEVC": ["H.265 / HEVC", "device"],
    "V_PRORES": ["Apple ProRes", "no"],
    "V_THEORA": ["Theora", "mostly"],
    "V_VP8": ["VP8", "yes"],
    "V_VP9": ["VP9", "yes"],
    "V_AV1": ["AV1", "mostly"],
    "V_FFV1": ["FFV1 lossless", "no"],
    "V_WMVMV3": ["Windows Media Video", "no"],
    "V_1RM01": ["RealVideo", "no"],
    "A_AAC": ["AAC", "yes"],
    "A_AAC/MPEG4/LC": ["AAC-LC", "yes"],
    "A_AAC/MPEG2/LC": ["AAC", "yes"],
    "A_MPEG/L3": ["MP3", "yes"],
    "A_MPEG/L2": ["MP2", "no"],
    "A_AC3": ["Dolby Digital", "chrome"],
    "A_EAC3": ["Dolby Digital Plus", "chrome"],
    "A_TRUEHD": ["Dolby TrueHD", "no"],
    "A_DTS": ["DTS", "no"],
    "A_VORBIS": ["Vorbis", "yes"],
    "A_OPUS": ["Opus", "yes"],
    "A_FLAC": ["FLAC", "yes"],
    "A_ALAC": ["Apple Lossless", "mostly"],
    "A_PCM/INT/LIT": ["uncompressed PCM", "yes"],
    "A_PCM/INT/BIG": ["uncompressed PCM", "yes"],
    "A_PCM/FLOAT/IEEE": ["PCM float", "yes"],
    "A_RAAC": ["RealAudio", "no"],
    "S_TEXT/UTF8": ["SubRip in the container", "yes"],
    "S_TEXT/ASS": ["ASS in the container", "no"],
    "S_HDMV/PGS": ["Blu-ray image subtitles", "no"],
    "S_KATE": ["Kate", "no"],
    avc1: ["H.264 / AVC", "yes"],
    avc3: ["H.264 / AVC", "yes"],
    hev1: ["H.265 / HEVC", "device"],
    hvc1: ["H.265 / HEVC", "device"],
    h265: ["H.265 / HEVC", "device"],
    mp4v: ["MPEG-4 Part 2", "no"],
    divx: ["DivX", "no"],
    dx50: ["DivX 5", "no"],
    dx5g: ["DivX", "no"],
    xvid: ["Xvid", "no"],
    DIVX: ["DivX", "no"],
    XVID: ["Xvid", "no"],
    MJPG: ["Motion JPEG", "no"],
    i420: ["raw YUV", "no"],
    rawv: ["raw video", "no"],
    cvid: ["Cinepak", "no"],
    svg1: ["Sorenson Video", "no"],
    vp08: ["VP8", "yes"],
    vp09: ["VP9", "yes"],
    av01: ["AV1", "mostly"],
    thea: ["Theora", "mostly"],
    mjp2: ["Motion JPEG 2000", "no"],
    apch: ["Apple ProRes", "no"],
    apcs: ["Apple ProRes", "no"],
    rap: ["RealAudio", "no"],
    mp4a: ["AAC", "yes"],
    aac: ["AAC", "yes"],
    sowt: ["uncompressed PCM", "yes"],
    fl32: ["PCM float", "mostly"],
    fLaC: ["FLAC", "yes"],
    opus: ["Opus", "yes"],
    vorb: ["Vorbis", "yes"],
    ac3: ["Dolby Digital", "chrome"],
    ec3: ["Dolby Digital Plus", "chrome"],
    cac3: ["Dolby Digital Plus", "chrome"],
    alac: ["Apple Lossless", "mostly"],
    samr: ["AMR", "no"],
    mp3: ["MP3", "yes"],
    ".mp3": ["MP3", "yes"],
    twos: ["uncompressed PCM", "yes"],
    tlvi: ["3ivx", "no"]
  };

  function describeCodec(id) {
    var key = String(id == null ? "" : id).trim();
    if (!key) return { name: "not stated", play: "unknown" };
    var hit = CODECS[key] || CODECS[key.toUpperCase()] || CODECS[key.toLowerCase()];
    if (hit) return { name: hit[0], play: hit[1] };
    if (/h26[45]|avc/i.test(key)) return { name: /5|hevc/i.test(key) ? "H.265 / HEVC" : "H.264 / AVC", play: /5|hevc/i.test(key) ? "device" : "yes" };
    if (/vp9/i.test(key)) return { name: "VP9", play: "yes" };
    if (/vp8/i.test(key)) return { name: "VP8", play: "yes" };
    if (/av1/i.test(key)) return { name: "AV1", play: "mostly" };
    if (/divx|xvid|wmv|vc1|mpeg-?1|mpeg-?2|prores|real|cinema/.test(key)) return { name: key, play: "no" };
    return { name: key, play: "unknown" };
  }

  /* The panel that explains a refusal. Lines, not one wall of text. */
  function advice(errText, info) {
    var out = [];
    info = info || {};
    var file = info.file || ("input." + (info.ext || "mkv"));
    var toMp4 = '<code>ffmpeg -i "' + file + '" -c:v libx264 -crf 20 -preset veryfast -c:a aac -movflags +faststart out.mp4</code>';
    var remux = '<code>ffmpeg -i "' + file + '" -c copy -sn out.mp4</code>';
    if (info.play === "no") {
      out.push("The container reads as " + (info.container || "fine") + ". The video inside it is " +
        info.video + ", and no browser ships a decoder for that. The file is not broken, it is in somebody else's codec.");
      out.push("Remux it if the stream underneath is actually H.264 — that is a copy, not a re-encode, and takes seconds:");
      out.push(remux);
      out.push("If it is genuinely " + info.video + ", you have to transcode once:");
      out.push(toMp4);
    } else if (info.play === "device") {
      out.push("This is " + info.video + ". HEVC plays where the machine has a hardware decoder for it: usually Safari and Edge on Apple silicon, sometimes Windows with the HEVC extension, almost never plain Linux.");
      out.push("Try the file in another browser before you touch it. If nothing will play it, transcode:");
      out.push(toMp4);
    } else if (info.play === "chrome" || info.play === "mostly") {
      out.push("The picture is " + (info.video || "unsupported") + " and the sound is " + (info.audio || "unsupported") +
        ". Both are in the gap between browsers, which is why the same file works in one and not the next. If you get frames and no audio, it is the audio track refusing, not the video.");
      out.push("Copying the streams into an mp4 usually fixes it:");
      out.push(remux);
    } else if (info.play === "yes") {
      out.push("Header says " + (info.video || "no video track") + (info.audio ? " with " + info.audio : "") +
        ", which this browser should decode on its own. If it still refuses, the file is truncated or the moov/SeekHead is missing.");
    } else {
      out.push("No codec could be read out of this file's header, which usually means one of: the file was cut short while copying, it is encrypted, or the extension is lying about what it is.");
    }
    if (errText) out.push("What the media element reported: <code>" + errText + "</code>");
    if (info.note) out.push(info.note);
    out.push("Nothing here is uploaded. The bytes stay in this tab, and the header scan only reads the first " +
      Math.round(HEAD_PROBE / 1048576) + " MB and the last " + Math.round(TAIL_PROBE / 1048576) + " MB of the file.");
    return out;
  }

  /* ------------------------------ EBML / Matroska ------------------------ */
  /* An element is: id (vint, kept whole) then size (vint, marker bit stripped).
     Getting the marker bit wrong is the classic way to write a parser that only
     works on tiny files, so the mask is computed from the byte length here. */
  function vintLen(b, p) {
    var first = b[p];
    if (!first) return 0;
    for (var len = 1; len <= 8; len++) if (first & (0x80 >> (len - 1))) return len;
    return 0;
  }
  function readId(b, p, end) {
    var len = vintLen(b, p);
    if (!len || p + len > end) return null;
    var id = 0;
    for (var i = 0; i < len; i++) id = id * 256 + b[p + i];
    return { id: id, next: p + len, raw: p };
  }
  function readSize(b, p, end) {
    var len = vintLen(b, p);
    if (!len || p + len > end) return null;
    var mask = 0x80 >> (len - 1);
    var val = b[p] & (mask - 1);
    var allOnes = (val === mask - 1);
    for (var i = 1; i < len; i++) {
      val = val * 256 + b[p + i];
      if (b[p + i] !== 0xff) allOnes = false;
    }
    if (allOnes && len < 8) return { size: -1, next: p + len };   /* unknown length */
    return { size: val, next: p + len };
  }

  var EBML_MASTER = {
    0x1a45dfa3: 1, 0x18538067: 1, 0x1549a966: 1, 0x1654ae6b: 1, 0xae: 1,
    0xe0: 1, 0xe1: 1, 0x114d9b74: 1, 0x4dbb: 1, 0x533e4f66: 1, 0x1f43b675: 1,
    0x2e7b12: 1, 0x1c53bb6b: 1, 0x4724: 1
  };

  function walkEBML(b, start, end, depth, visit) {
    var p = start, guard = 0;
    while (p < end && depth <= 7 && guard++ < 3000) {
      var idr = readId(b, p, end);
      if (!idr) return;
      var sz = readSize(b, idr.next, end);
      if (!sz) return;
      var body = sz.next, size = sz.size;
      if (size < 0) size = end - body;
      if (body + size > end) size = end - body;
      if (size < 0) return;
      var go = visit(idr.id, body, size, depth);
      if (go === false) return;
      if (EBML_MASTER[idr.id]) {
        walkEBML(b, body, body + size, depth + 1, visit);
      }
      var np = body + size;
      if (np <= p) return;
      p = np;
    }
  }

  function probeEBML(b, out) {
    var track = null;
    out.scale = 0; out.durRaw = null;
    walkEBML(b, 0, b.length, 0, function (id, body, size, depth) {
      if (id === 0x4282) out.doctype = ascii(b, body, size);
      else if (id === 0x4d80 || id === 0x5741) { if (!out.app) out.app = ascii(b, body, size); }
      else if (id === 0x2ad7b1) out.scale = readUInt(b, body, size);   /* TimecodeScale, ns per tick */
      else if (id === 0x4489) out.durRaw = size === 4 ? floats(b, body, false) : floats(b, body, true);
      else if (id === 0xae) { track = { type: 0, codec: "", def: false }; out.tracks.push(track); }
      else if (id === 0x83 && track) track.type = readUInt(b, body, size);
      else if (id === 0x86 && track) track.codec = ascii(b, body, size);
      else if (id === 0x3e83 && track) track.def = readUInt(b, body, size) === 1;
      else if (id === 0xb0 && track) track.width = readUInt(b, body, size);
      else if (id === 0xba && track) track.height = readUInt(b, body, size);
      else if (id === 0x22b59c && track) track.lang = ascii(b, body, size);
      else if (id === 0x53800047 && !out.title) out.title = ascii(b, body, size);
      return true;
    });
    /* Duration is counted in TimecodeScale ticks, which is 1 ms unless the file
       says otherwise. Reading it as seconds is how you get a 3-hour film that
       claims to be 3 hours long per frame. */
    if (out.durRaw != null && isFinite(out.durRaw)) {
      out.duration = out.durRaw * (out.scale > 0 ? out.scale : 1000000) / 1e9;
    }
    delete out.durRaw;
    out.tracks.forEach(function (t) {
      var kind = t.type === 1 ? "video" : t.type === 2 ? "audio" : t.type === 17 || t.type === 18 ? "subs" : "other";
      out.codecs.push({ fourcc: t.codec, kind: kind, def: t.def, lang: t.lang || "", width: t.width || 0, height: t.height || 0 });
      if (kind === "video" && t.width && t.height && !out.width) { out.width = t.width; out.height = t.height; }
    });
  }

  /* ------------------------------ ISO base media ------------------------- */
  function probeMP4(b, out, start, end) {
    var p = start, guard = 0, handler = "";
    var CONTAINERS = { moov: 1, trak: 1, mdia: 1, minf: 1, stbl: 1, edts: 1, udta: 1, meta: 1, ilst: 1 };
    while (p + 8 <= end && guard++ < 700) {
      var size = readUInt(b, p, 4);
      var type = fourcc(b, p + 4);
      var body = p + 8;
      if (size === 1) {
        size = readUInt64(b, p + 8);
        body = p + 16;
      } else if (size === 0) {
        size = end - p;
      }
      if (size < 8 || p + size > end + 8) break;
      var boxEnd = Math.min(end, p + size);

      if (type === "ftyp") {
        out.brand = fourcc(b, body, 4);
        var compat = [];
        for (var c = body + 8; c + 4 <= boxEnd && compat.length < 12; c += 4) compat.push(fourcc(b, c, 4));
        out.compat = compat;
      } else if (type === "qt  ") {
        /* nothing: brands carry it */
      } else if (CONTAINERS[type]) {
        if (type === "meta" || type === "ilst") probeMP4(b, out, body + 4, boxEnd);
        else probeMP4(b, out, body, boxEnd);
      } else if (type === "hdlr") {
        handler = fourcc(b, body + 8, 4);
        if (handler === "vide" || handler === "soun" || handler === "subt" || handler === "text") out.lastHandler = handler;
      } else if (type === "mvhd") {
        var v = b[body];
        var ts, dur;
        if (v === 1) { ts = readUInt(b, body + 20, 4); dur = readUInt64(b, body + 24, 4); }
        else { ts = readUInt(b, body + 12, 4); dur = readUInt(b, body + 16, 4); }
        if (ts > 0 && dur > 0) out.duration = dur / ts;
      } else if (type === "tkhd") {
        var v2 = b[body];
        var off = v2 === 1 ? boxEnd - 8 : boxEnd - 8;
        var w = readUInt(b, off, 4) >> 16, h = readUInt(b, off + 4, 4) >> 16;
        if (w > 0 && h > 0 && !out.width) { out.width = w; out.height = h; }
      } else if (type === "stsd") {
        var e = body + 8;
        if (e + 8 <= boxEnd) {
          var fmt = fourcc(b, e + 4, 4);
          var kind = (out.lastHandler === "soun") ? "audio" : (out.lastHandler === "subt" || out.lastHandler === "text") ? "subs" : "video";
          out.codecs.push({ fourcc: fmt, kind: kind, def: out.codecs.length === 0 });
        }
      } else if (type === "elst" || type === "sbgp" || type === "sgpd") {
        /* read and thrown away — knowing they exist is not worth a panel */
      }
      p = boxEnd;
    }
  }

  /* --------------------------- the front door: probe() ------------------- */
  function probe(bytes, name) {
    var out = {
      file: String(name || ""), ext: extOf(name),
      container: "unknown", brand: "", doctype: "", app: "", title: "",
      duration: null, width: null, height: null,
      codecs: [], tracks: [], subs: false, note: "", ok: false, play: "unknown",
      video: "", audio: "", videoPlay: "unknown", audioPlay: "unknown",
      compat: [], scanned: 0
    };
    if (!bytes || !bytes.length) {
      out.container = "empty";
      out.note = "The file arrived with no bytes in it.";
      return finishInfo(out);
    }
    var head = bytes.subarray(0, Math.min(bytes.length, HEAD_PROBE));
    out.scanned = head.length;

    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
      probeEBML(head, out);
      var dt = (out.doctype || "").toLowerCase();
      out.container = dt.indexOf("webm") === 0 ? "WebM" : dt.indexOf("matroska") === 0 ? "Matroska" :
        (dt ? "EBML / " + dt : "EBML (no doctype stated)");
      out.ok = true;
    } else if (head.length > 12 && fourcc(head, 4) === "ftyp") {
      probeMP4(head, out, 0, head.length);
      if (out.duration == null && bytes.length > head.length + 16) {
        /* look for a moov near the end, which is normal for camera files */
        var from = Math.max(0, bytes.length - TAIL_PROBE);
        for (var t = from; t + 8 < bytes.length - 4; t++) {
          if (bytes[t] === 0x6d && bytes[t + 1] === 0x6f && bytes[t + 2] === 0x6f && bytes[t + 3] === 0x76) {
            var back = t - 4;
            if (back >= 0) {
              var bs = readUInt(bytes, back, 4);
              if (bs > 8 && bs < bytes.length - back) { probeMP4(bytes, out, back, bytes.length); break; }
            }
          }
        }
      }
      if (out.duration == null && !out.codecs.length) {
        out.note = "Only an ftyp box turned up, so the moov box is outside what was scanned. Files like this play from the beginning and stall everywhere else.";
      }
      var brand = (out.brand || "").toLowerCase();
      out.container = brand === "qt  " ? "QuickTime" :
        (brand === "m4v " || brand === "m4a " ? "MPEG-4 (" + out.brand.trim() + ")" : "MPEG-4");
      if (brand === "avc1" || brand === "iso2") out.container = "MPEG-4";
      out.ok = true;
    } else if (fourcc(head, 0) === "RIFF" && /AVI /.test(ascii(head, 8, 4))) {
      out.container = "Audio Video Interleave";
      var limit = Math.min(head.length - 4, 128 * 1024);
      for (var a = 0; a < limit; a++) {
        var f = fourcc(head, a);
        if (/^(vids|auds)$/ .test(f)) continue;
        if (CODECS[f] && f.length === 4) {
          out.codecs.push({ fourcc: f, kind: ascii(head, Math.max(0, a - 32), 4) === "auds" ? "audio" : "video" });
        }
        if (out.codecs.length >= 4) break;
      }
      out.note = "AVI is a 1992 container and browsers never implemented it. Whatever the codec is, the wrapper has to go: " +
        "<code>ffmpeg -i in.avi -c copy out.mkv</code> is a copy, not a re-encode.";
      out.ok = true;
    } else if (fourcc(head, 0) === "OggS") {
      out.container = "Ogg";
      out.note = "Ogg Theora plays, Ogg video with other codecs does not.";
      out.ok = true;
    } else if (ascii(head, 0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) {
      out.container = "MPEG audio";
      out.ok = true;
    } else if (fourcc(head, 0) === "fLaC") {
      out.container = "FLAC"; out.ok = true;
    } else if (fourcc(head, 0) === "RIFF" && /WAVE/.test(ascii(head, 8, 4))) {
      out.container = "WAV"; out.ok = true;
      for (var w = 0; w < Math.min(head.length - 4, 65536); w++) {
        var wf = fourcc(head, w);
        if (CODECS[wf]) { out.codecs.push({ fourcc: wf, kind: "audio" }); break; }
      }
    } else if (fourcc(head, 0) === "FORM" && /AIFF/.test(ascii(head, 8, 4))) {
      out.container = "AIFF"; out.ok = true;
    } else if (ascii(head, 0, 3) === "FLV" || fourcc(head, 0) === "MAUD" || fourcc(head, 0) === "MDAT") {
      out.container = "Flash Video";
      out.note = "A container from the plugin era. Remux: <code>ffmpeg -i in.flv -c copy out.mp4</code>";
      out.ok = true;
    } else if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01) {
      out.container = "MPEG stream (packets)";
      out.note = "MPEG-PS / transport streams are not browser containers. Demux first: " +
        "<code>ffmpeg -i in.mpg -c copy out.mkv</code>";
    } else if (head[0] === 0x47) {
      out.container = "MPEG transport stream";
      out.note = "TS needs remuxing before any browser will look at it.";
    } else {
      var printable = 0, n = Math.min(256, head.length);
      for (var z = 0; z < n; z++) {
        var c = head[z];
        if (c === 10 || c === 13 || c === 9 || (c >= 32 && c < 127)) printable++;
      }
      if (n > 0 && printable / n > 0.9) {
        out.container = "text";
        out.note = "This is a text file, not a media file. If it was meant to be captions, hand it to the subtitle box instead of the playlist.";
      } else {
        out.container = "unknown";
        out.note = "Nothing in the first " + Math.round(HEAD_PROBE / 1048576) + " MB matched a container this page knows. The extension said <code>." +
          (out.ext || "?") + "</code>";
      }
    }
    return finishInfo(out);
  }

  function finishInfo(out) {
    var vids = out.codecs.filter(function (c) { return c.kind === "video"; });
    var auds = out.codecs.filter(function (c) { return c.kind === "audio"; });
    var subs = out.codecs.filter(function (c) { return c.kind === "subs"; });
    var v = describeCodec(vids.length ? vids[0].fourcc : "");
    var a = describeCodec(auds.length ? auds[0].fourcc : "");
    out.video = vids.length ? v.name : "";
    out.audio = auds.length ? a.name : "";
    out.videoPlay = vids.length ? v.play : "unknown";
    out.audioPlay = auds.length ? a.play : "unknown";
    out.subsInside = subs.length;
    out.subs = out.tracks.some(function (t) { return t.type === 17 || t.type === 18; }) || subs.length > 0;
    out.tracks.forEach(function (t) {
      var d = describeCodec(t.codec);
      if (t.type === 1) { t.desc = d.name; t.play = d.play; }
      else if (t.type === 2) { t.desc = d.name; t.play = d.play; }
      else { t.desc = d.name; t.play = d.play; }
    });
    if (!vids.length && auds.length) out.play = a.play;
    else if (vids.length) out.play = v.play === "yes" && a.play === "no" ? "no" : v.play;
    else if (out.container === "MPEG audio" || out.container === "FLAC" || out.container === "WAV" || out.container === "AIFF") out.play = "yes";
    else if (out.container === "MPEG-4" || out.container === "QuickTime" || out.container === "MPEG-4 (m4v)" ||
      out.container === "MPEG-4 (m4a)") { out.play = out.note ? "unknown" : "yes"; }
    else if (out.container === "Ogg") out.play = "mostly";
    if (out.duration != null && (!isFinite(out.duration) || out.duration < 0)) out.duration = null;
    if (out.duration === 0) out.duration = null;
    return out;
  }

  /* ------------------------------- captions ----------------------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fmtVtt(sec) {
    sec = num(sec, 0);
    if (sec < 0) sec = 0;
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60),
      s = Math.floor(sec % 60), ms = Math.round((sec - Math.floor(sec)) * 1000);
    if (ms >= 1000) { ms -= 1000; s += 1; }
    if (s >= 60) { s -= 60; m += 1; }
    if (m >= 60) { m -= 60; h += 1; }
    var pad = function (n, l) { n = String(n); while (n.length < (l || 2)) n = "0" + n; return n; };
    return pad(h, 2) + ":" + pad(m) + ":" + pad(s) + "." + pad(ms, 3);
  }

  /* SRT, microsecond VTT, and the plain-text mess a subtitle editor exports. */
  function srtToVtt(text) {
    var src = String(text == null ? "" : text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var out = ["WEBVTT", ""], i = 0;
    var TIME = /^(\d{1,3}:?\d{2}:\d{2}[.,]\d{1,6}|\d{1,3}:\d{2}[.,]\d{1,6}|\d+[.,]\d+)\s*-->\s*(\S+)\s*(.*)$/;
    while (i < src.length) {
      var line = src[i];
      if (!line || !line.trim()) { i++; continue; }
      if (/^WEBVTT/i.test(line.trim())) { i++; continue; }
      if (/^STYLE|^::|^NOTE/i.test(line.trim())) {           /* vtt style blocks: pass through until blank */
        while (i < src.length && src[i].trim()) { out.push(src[i]); i++; }
        out.push("");
        continue;
      }
      var numLine = /^\s*\d+\s*$/.test(line);
      var tIdx = numLine ? i + 1 : i;
      var m = TIME.exec((src[tIdx] || "").trim());
      if (m) {
        var start = hmsToSec(m[1]), stop = hmsToSec(m[2]);
        if (isFinite(start) && isFinite(stop) && stop > start) {
          if (numLine) out.push(src[i].trim());
          out.push(fmtVtt(start) + " --> " + fmtVtt(stop) + (m[3] ? " " + m[3].trim() : ""));
          i = tIdx + 1;
          var body = [];
          while (i < src.length && src[i].trim() && !TIME.test(src[i].trim()) && !/^\s*\d+\s*$/.test(src[i])) {
            body.push(esc(src[i]).replace(/\\N/gi, "\n"));
            i++;
          }
          out.push(body.join("\n")
            .replace(/&lt;(\/?)(i|b|u)&gt;/g, "<$1$2>")
            .replace(/\\h/g, " ")
            .replace(/&lt;\/?(font|span|color)[^&]*&gt;/g, ""));
          out.push("");
          continue;
        }
      }
      i++;
    }
    return out.join("\n");
  }
  function countCues(vttText) {
    return String(vttText).split("\n").filter(function (l) { return /-->\s*\d/.test(l); }).length;
  }

  /* ------------------------------ playlist ------------------------------ */
  function naturalKey(name) {
    /* so "Track 2" sorts before "Track 10", which a plain string sort refuses to do */
    return String(name).toLowerCase().replace(/\d+/g, function (d) {
      return "\u0000" + (new Array(12 - Math.min(11, d.length)).join("0")) + d;
    });
  }
  function sortByNatural(names) {
    return Array.prototype.slice.call(names).sort(function (a, b) {
      var ka = naturalKey(a), kb = naturalKey(b);
      return ka < kb ? -1 : (ka > kb ? 1 : 0);
    });
  }
  function nextIndex(cur, len, stopAtEnd) {
    if (!len) return -1;
    if (cur + 1 < len) return cur + 1;
    return stopAtEnd ? -1 : 0;
  }
  function prevIndex(cur, len) {
    if (!len) return -1;
    return cur - 1 < 0 ? len - 1 : cur - 1;
  }
  function sameFile(a, b) {
    return !!a && !!b && a.name === b.name && a.size === b.size;
  }
  /* drop .mkv files whose sibling .srt/.vtt is in the same pick, so loading a
     folder of episodes brings the captions with it */
  function guessPairs(files) {
    var subs = files.filter(function (f) { return /\.(srt|vtt)$/i.test(f.name); });
    var out = [];
    files.filter(function (f) { return !/\.(srt|vtt)$/i.test(f.name); }).forEach(function (f) {
      var base = f.name.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
      var match = subs.filter(function (s) {
        return s.name.replace(/\.[a-z0-9]+$/i, "").toLowerCase() === base;
      })[0];
      out.push({ file: f, sub: match || null });
    });
    return out;
  }

  /* --------------------------- where you left off ----------------------- */
  function resumeKey(name, size, modified) {
    var safe = String(name).replace(/[^a-z0-9._-]+/gi, "_").slice(-58);
    return "photon.resume." + safe + "." + (Number(size) || 0) + "." + Math.floor((Number(modified) || 0) / 60000);
  }
  function resumeNote(sec) {
    sec = Number(sec);
    return isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  }
  /* not worth a modal for 2 seconds, and pointless in the last few */
  function shouldResume(at, duration) {
    at = Number(at); duration = Number(duration);
    if (!isFinite(at) || at < 3) return false;
    if (isFinite(duration) && duration > 0 && duration - at < 4) return false;
    return true;
  }
  function saveResume(store, key, time, duration) {
    if (!store || !key) return null;
    time = Number(time); duration = Number(duration);
    if (!isFinite(time) || time < 0) return store;
    if (!shouldResume(time, duration)) { delete store[key]; return store; }
    store[key] = { t: Math.round(time * 10) / 10, d: isFinite(duration) ? Math.round(duration) : 0, at: Date.now() };
    return store;
  }
  function loadResume(store, key) {
    if (!store || !key || !store[key]) return 0;
    var t = Number(store[key].t);
    return isFinite(t) && t > 0 ? t : 0;
  }
  function dropOldResume(store, keep) {
    /* a few hundred keys is the point where localStorage starts being slow, so
       the file you have not opened in a year is the one that goes */
    var keys = Object.keys(store).filter(function (k) { return k.indexOf("photon.resume.") === 0; });
    if (keys.length <= (keep || 60)) return 0;
    keys.sort(function (a, b) { return (store[b].at || 0) - (store[a].at || 0); });
    keys.slice(keep || 60).forEach(function (k) { delete store[k]; });
    return keys.length - (keep || 60);
  }

  /* ----------------------- rates, seeking, A-B, volume ------------------ */
  var RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];
  function clampRate(r) {
    r = Number(r);
    if (!isFinite(r) || r <= 0) return 1;
    return clamp(r, 0.25, 4);
  }
  function nearestRate(r) {
    r = clampRate(r);
    var best = RATES[0], d = Infinity;
    RATES.forEach(function (x) { if (Math.abs(x - r) < d) { d = Math.abs(x - r); best = x; } });
    return best;
  }
  function clampSeek(to, duration) {
    to = Number(to); duration = Number(duration);
    if (!isFinite(to) || to < 0) return 0;
    if (!isFinite(duration) || duration <= 0) return 0;
    /* browsers throw if you aim past the end of an unseekable stream */
    return Math.min(to, Math.max(0, duration - 0.05));
  }
  function stepSeek(current, delta, duration) {
    current = num(current, 0);
    if (delta > 0) return clampSeek(current + delta, duration);
    return Math.max(0, num(current, 0) + delta);
  }
  function abState(a, b) {
    var set = function (x) { return x === null || x === undefined || x === "" || !isFinite(Number(x)) ? null : Number(x); };
    var na = set(a), nb = set(b);
    var okA = na !== null && na >= 0, okB = nb !== null && nb > 0;
    if (okA && okB && nb <= na) return { a: na, b: null, on: false, bad: true };
    if (na !== null && !okA) return { a: null, b: nb, on: false, bad: false };
    return { a: okA ? na : null, b: okB ? nb : null, on: !!(okA && okB), bad: false };
  }
  function abDuration(ab) {
    if (!ab || !ab.on) return 0;
    return Math.max(0, ab.b - ab.a);
  }
  function abTick(time, ab) {
    if (!ab || !ab.on) return { action: "none" };
    if (time > ab.b) return { action: "seek", to: ab.a };
    if (time < ab.a - 0.5) return { action: "seek", to: ab.a };
    return { action: "none" };
  }
  function volumeLabel(v) {
    v = num(v, 1);
    return Math.round(clamp(v, 0, 1) * 100) + "%";
  }

  /* ------------------- what the browser's error code means -------------- */
  var MEDIA_ERR = {
    1: "aborted — something else took over the element, usually a second play() on the same file",
    2: "network — this is a local file, so read it as: the tab lost the handle on the file while loading",
    3: "decode — the container opened and the stream inside it could not be decoded. That is a codec problem, not a broken file",
    4: "unsupported — the browser will not demux this container at all, whatever is inside it"
  };
  function mediaErrorText(err, info) {
    var code = err && err.code;
    var base = MEDIA_ERR[code] || ("error code " + code + " (" + ((err && err.message) || "no message") + ")");
    var guess = "";
    if (info && info.ext && /avi|wmv|asf|flv|vob|mpg|mpeg|mts|ts|divx/i.test(info.ext)) {
      guess = " The ." + info.ext + " container alone is enough to do this.";
    } else if (info && info.videoPlay === "no") {
      guess = " The header says " + info.video + ", which is the part no browser decodes.";
    } else if (info && info.videoPlay === "device") {
      guess = " The header says " + info.video + ", which needs a hardware decoder.";
    } else if (info && info.videoPlay === "yes" && info.audioPlay === "no") {
      guess = " The video is fine but the audio is " + info.audio + ", and some browsers fail the whole file rather than mute one track.";
    }
    return base + guess;
  }

  /* a caption menu needs track kinds; the dom layer owns the element, this owns the words */
  function trackLabel(tr, i) {
    var k = tr.kind || "subtitles";
    var label = tr.label || (k + " " + (i + 1));
    return label + (tr.srclang ? " [" + tr.srclang + "]" : "");
  }

  function formatProbeLine(info) {
    var bits = [];
    bits.push(info.container || "unknown container");
    if (info.video) bits.push(info.video + (info.videoPlay === "unknown" ? "" : " (" + info.videoPlay + ")"));
    if (info.audio) bits.push(info.audio + (info.audioPlay === "unknown" ? "" : " (" + info.audioPlay + ")"));
    if (info.width && info.height) bits.push(info.width + "×" + info.height);
    if (info.duration) bits.push(fmtTime(info.duration));
    if (info.subs) bits.push(info.subsInside + " caption track(s) inside");
    if (info.app) bits.push("written by " + info.app);
    return bits.join(" · ");
  }

  /* ============================== exported ============================== */
  return {
    clamp: clamp, num: num,
    fmtTime: fmtTime, hmsToSec: hmsToSec, fmtVtt: fmtVtt,
    extOf: extOf, accepts: accepts,
    describeCodec: describeCodec, advice: advice, mediaErrorText: mediaErrorText,
    probe: probe, formatProbeLine: formatProbeLine,
    srtToVtt: srtToVtt, countCues: countCues, trackLabel: trackLabel,
    sortByNatural: sortByNatural, naturalKey: naturalKey, nextIndex: nextIndex, prevIndex: prevIndex,
    sameFile: sameFile, guessPairs: guessPairs,
    resumeKey: resumeKey, resumeNote: resumeNote, shouldResume: shouldResume,
    saveResume: saveResume, loadResume: loadResume, dropOldResume: dropOldResume,
    RATES: RATES, clampRate: clampRate, nearestRate: nearestRate,
    clampSeek: clampSeek, stepSeek: stepSeek,
    abState: abState, abDuration: abDuration, abTick: abTick, volumeLabel: volumeLabel,
    VIDEO_EXT: VIDEO_EXT, AUDIO_EXT: AUDIO_EXT, SUB_EXT: SUB_EXT, RISKY_EXT: RISKY_EXT,
    HEAD_PROBE: HEAD_PROBE, TAIL_PROBE: TAIL_PROBE, MEDIA_ERR: MEDIA_ERR
  };
});
