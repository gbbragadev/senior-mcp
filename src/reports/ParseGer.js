#!/usr/bin/env node
/**
 * ParseGer.js — Senior HCM .GER Report Model Parser
 *
 * Parses decompressed .raw payloads (Delphi TReader binary format)
 * into structured JSON. Based on decompiled TSReader/TSBand/etc. from asas-ui.jar.
 *
 * Usage:
 *   node tools/ParseGer.js <file.raw>                     # parse single file
 *   node tools/ParseGer.js --batch <indir> <outdir>       # batch parse
 *   node tools/ParseGer.js --summary <file.raw>           # metadata only
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ─── TValueType enum (Delphi-compatible tag bytes) ───────────────────────────
const VT = {
  vaNull:       0x00,
  vaList:       0x01,
  vaInt8:       0x02,
  vaInt16:      0x03,
  vaInt32:      0x04,
  vaExtended:   0x05,
  vaString:     0x06,
  vaIdent:      0x07,
  vaFalse:      0x08,
  vaTrue:       0x09,
  vaBinary:     0x0A,
  vaSet:        0x0B,
  vaLString:    0x0C,
  vaNil:        0x0D,
  vaCollection: 0x0E,
  vaSingle:     0x0F,
  vaCurrency:   0x10,
  vaDate:       0x11,
  vaWString:    0x12,
  vaInt64:      0x13,
};

const VT_NAMES = Object.fromEntries(Object.entries(VT).map(([k, v]) => [v, k]));

// ─── TReader: low-level binary reader ────────────────────────────────────────
class TReader {
  constructor(buf, offset = 0) {
    this.buf = buf;
    this.pos = offset;
    this.version = 0;    // set after header parse
    this.errors = [];
  }

  remaining() { return this.buf.length - this.pos; }

  readRawByte() {
    if (this.pos >= this.buf.length) throw new ParseError('EOF reading rawByte', this.pos);
    return this.buf[this.pos++];
  }

  readRawShort() {
    if (this.pos + 2 > this.buf.length) throw new ParseError('EOF reading rawShort', this.pos);
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readRawInt() {
    if (this.pos + 4 > this.buf.length) throw new ParseError('EOF reading rawInt', this.pos);
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readRawLong() {
    if (this.pos + 8 > this.buf.length) throw new ParseError('EOF reading rawLong', this.pos);
    const v = this.buf.readBigInt64LE(this.pos);
    this.pos += 8;
    return Number(v);
  }

  readRawFloat() {
    if (this.pos + 4 > this.buf.length) throw new ParseError('EOF reading rawFloat', this.pos);
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }

  readRawDouble() {
    if (this.pos + 8 > this.buf.length) throw new ParseError('EOF reading rawDouble', this.pos);
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }

  peekByte() {
    if (this.pos >= this.buf.length) return -1;
    return this.buf[this.pos];
  }

  nextValue() { return this.peekByte(); }

  // Tagged reads
  readInteger() {
    const tag = this.readRawByte();
    switch (tag) {
      case VT.vaInt8:  return this.buf.readInt8(this.pos - 1 + 1) & 0xFF ? this.buf.readInt8(this.pos++) : (this.pos++, 0);
      case VT.vaInt16: return this.readRawShort();
      case VT.vaInt32: return this.readRawInt();
      case VT.vaInt64: return this.readRawLong();
      default:
        // Some code paths expect readInteger to handle vaInt8 as unsigned
        throw new ParseError(`readInteger: unexpected tag 0x${tag.toString(16)} at offset ${this.pos - 1}`, this.pos - 1);
    }
  }

  readBoolean() {
    const tag = this.readRawByte();
    if (tag === VT.vaFalse) return false;
    if (tag === VT.vaTrue) return true;
    throw new ParseError(`readBoolean: unexpected tag 0x${tag.toString(16)} at offset ${this.pos - 1}`, this.pos - 1);
  }

  readString() {
    const tag = this.readRawByte();
    if (tag === VT.vaString) {
      const len = this.readRawByte();
      return this._readBytes(len).toString('latin1');
    }
    if (tag === VT.vaLString) {
      const len = this.readRawInt();
      return this._readBytes(len).toString('latin1');
    }
    if (tag === VT.vaWString) {
      const len = this.readRawInt();
      return this._readBytes(len * 2).toString('utf16le');
    }
    // vaIdent also valid in some contexts
    if (tag === VT.vaIdent) {
      const len = this.readRawByte();
      return this._readBytes(len).toString('latin1');
    }
    throw new ParseError(`readString: unexpected tag 0x${tag.toString(16)} at offset ${this.pos - 1}`, this.pos - 1);
  }

  readIdent() {
    const tag = this.readRawByte();
    switch (tag) {
      case VT.vaIdent: {
        const len = this.readRawByte();
        return this._readBytes(len).toString('latin1');
      }
      case VT.vaFalse:  return 'False';
      case VT.vaTrue:   return 'True';
      case VT.vaNil:    return 'nil';
      case VT.vaNull:   return 'Null';
      default:
        throw new ParseError(`readIdent: unexpected tag 0x${tag.toString(16)}`, this.pos - 1);
    }
  }

  // Raw short string (no tag byte): 1-byte len + data
  readStr() {
    const len = this.readRawByte();
    return this._readBytes(len).toString('latin1');
  }

  readFloat() {
    const tag = this.readRawByte();
    switch (tag) {
      case VT.vaExtended: return this._readExtended();
      case VT.vaSingle:   return this.readRawFloat();
      case VT.vaInt8:     return this.buf.readInt8(this.pos++);
      case VT.vaInt16:    return this.readRawShort();
      case VT.vaInt32:    return this.readRawInt();
      default:
        throw new ParseError(`readFloat: unexpected tag 0x${tag.toString(16)}`, this.pos - 1);
    }
  }

  _readExtended() {
    // Delphi 80-bit extended: 8-byte fraction LE + 2-byte exponent LE
    // Approximate as double (read 10 bytes, use first 8 as double)
    if (this.pos + 10 > this.buf.length) throw new ParseError('EOF reading extended', this.pos);
    // Best effort: read as IEEE754 double from first 8 bytes
    const fraction = this.buf.readBigUInt64LE(this.pos);
    const expSign = this.buf.readUInt16LE(this.pos + 8);
    this.pos += 10;
    // Convert 80-bit extended to double (simplified)
    const sign = (expSign & 0x8000) ? -1 : 1;
    const exp = (expSign & 0x7FFF) - 16383;
    const mantissa = Number(fraction) / Math.pow(2, 63);
    if (exp === -16383) return 0;
    return sign * mantissa * Math.pow(2, exp);
  }

  readListBegin() {
    const tag = this.readRawByte();
    if (tag !== VT.vaList) {
      throw new ParseError(`readListBegin: expected vaList(0x01), got 0x${tag.toString(16)}`, this.pos - 1);
    }
  }

  readListEnd() {
    const tag = this.readRawByte();
    if (tag !== VT.vaNull) {
      throw new ParseError(`readListEnd: expected vaNull(0x00), got 0x${tag.toString(16)}`, this.pos - 1);
    }
  }

  endOfList() {
    return this.peekByte() === VT.vaNull;
  }

  _readBytes(n) {
    if (this.pos + n > this.buf.length) throw new ParseError(`EOF reading ${n} bytes`, this.pos);
    const slice = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  skipBytes(n) {
    this.pos += n;
  }
}

// Typed read with vaInt8 returning unsigned byte value
TReader.prototype.readIntegerSafe = function() {
  const tag = this.readRawByte();
  switch (tag) {
    case VT.vaInt8: {
      const b = this.readRawByte();
      return b > 127 ? b - 256 : b;  // signed
    }
    case VT.vaInt16: return this.readRawShort();
    case VT.vaInt32: return this.readRawInt();
    case VT.vaInt64: return this.readRawLong();
    default:
      throw new ParseError(`readInteger: unexpected tag 0x${tag.toString(16)}`, this.pos - 1);
  }
};

// Fix readInteger to properly handle vaInt8
TReader.prototype.readInteger = function() {
  const tag = this.readRawByte();
  switch (tag) {
    case VT.vaInt8:  return this.readRawByte();  // unsigned for most Senior uses
    case VT.vaInt16: return this.readRawShort();
    case VT.vaInt32: return this.readRawInt();
    case VT.vaInt64: return this.readRawLong();
    default:
      throw new ParseError(`readInteger: unexpected tag 0x${tag.toString(16)}`, this.pos - 1);
  }
};

// ─── ParseError ──────────────────────────────────────────────────────────────
class ParseError extends Error {
  constructor(msg, offset) {
    super(`@0x${(offset || 0).toString(16).padStart(4, '0')}: ${msg}`);
    this.offset = offset;
  }
}

// ─── TSReader: Senior-specific composites ────────────────────────────────────
class TSReader extends TReader {
  constructor(buf, offset = 0) {
    super(buf, offset);
  }

  readFont() {
    const font = {};
    font.color = this.readInteger();
    font.name = this.readString();
    font.size = this.readInteger();
    if (this.version >= 1101) {
      font.height = this.readInteger();
      font.pitch = this.readInteger();
    }
    font.styleBits = this.readRawByte();
    font.bold = !!(font.styleBits & 1);
    font.italic = !!(font.styleBits & 2);
    font.underline = !!(font.styleBits & 4);
    font.strikeout = !!(font.styleBits & 8);
    return font;
  }

  readBrush() {
    return {
      color: this.readInteger(),
      style: this.readInteger(),
    };
  }

  readPen() {
    return {
      color: this.readInteger(),
      style: this.readInteger(),
      mode: this.readInteger(),
      width: this.readInteger(),
    };
  }

  readImage() {
    const picType = this.readInteger();
    if (picType === 0) return { type: 'none' };
    const size = this.readInteger();
    this.skipBytes(size); // skip raw image bytes
    return { type: ['none', 'bitmap', 'jpeg', 'icon', 'metafile'][picType] || `unknown(${picType})`, size };
  }
}

// ─── Component Readers ───────────────────────────────────────────────────────

function readTFExportClass(r) {
  const exp = {};
  exp.fileExp = r.readBoolean();
  exp.htmlPag = r.readBoolean();
  exp.excel = r.readBoolean();
  exp.report = r.readBoolean();
  exp.model = r.readBoolean();
  if (r.version >= 2057) {
    exp.word = r.readBoolean();
  }
  return exp;
}

function readTSRule(r) {
  const rule = {};
  rule.propName = r.readString();
  rule.debug = r.readBoolean();
  rule.number = r.readInteger();
  rule.position = r.readInteger();
  rule.lines = [];
  if (r.version > 1030) {
    r.readListBegin();
    while (!r.endOfList()) {
      rule.lines.push(r.readString());
    }
    r.readListEnd();
  }
  rule.source = rule.lines.join('\n');
  return rule;
}

function readTSFrameDef(r) {
  return {
    penMode: r.readInteger(),
    penStyle: r.readInteger(),
    penWidth: r.readInteger(),
    penColor: r.readInteger(),
    top: r.readBoolean(),
    left: r.readBoolean(),
    bottom: r.readBoolean(),
    right: r.readBoolean(),
  };
}

function readTSDescricao(r) {
  const d = { _class: 'TSDescricao' };
  d.name = r.readString();
  d.font = r.readFont();
  d.color = r.readInteger();
  d.top = r.readInteger();
  d.left = r.readInteger();
  d.width = r.readInteger();
  d.height = r.readInteger();
  d.caption = r.readString();
  d.parentFont = r.readBoolean();
  d.parentColor = r.readBoolean();
  d.alignment = r.readInteger();
  d.picture = r.readString();
  d.canPrint = r.readBoolean();
  d.separator = r.readString();
  d.occurrence = r.readString();
  d.expanded = r.readBoolean();
  d.compressed = r.readBoolean();
  d.underlined = r.readBoolean();
  d.italic = r.readBoolean();
  d.boldface = r.readBoolean();
  d.number = r.readInteger();
  d.fieldList = r.readString();
  if (r.version > 1014) d.autoSize = r.readBoolean();
  if (r.version > 1015) d.transparent = r.readBoolean();
  if (r.version >= 1100) {
    d.leftTab = r.readInteger();
    d.rightTab = r.readInteger();
  }
  if (r.version >= 1100) {
    d.export = readTFExportClass(r);
  }
  d.onPrint = readTSRule(r);
  if (r.version <= 1014) r.readString(); // discard legacy
  if (r.version >= 2036) d.cascadeCharCase = r.readRawByte();
  return d;
}

function readTSCadastro(r) {
  const d = readTSDescricao(r);
  d._class = 'TSCadastro';
  d.table = r.readString();
  d.field = r.readString();
  d.tableFieldCorrelate = r.readString();
  d.nullField = r.readBoolean();
  if (r.version > 1022) d.history = r.readBoolean();
  return d;
}

function readTSTotal(r) {
  const d = readTSDescricao(r);
  d._class = 'TSTotal';
  d.fieldName = r.readString();
  d.clearBand = r.readString();
  d.typeTotal = r.readRawByte();
  d.fieldSpecial = r.readString();
  if (r.version < 1012) r.readString(); // discard legacy
  if (r.version > 1011) d.typeVar = r.readInteger();
  return d;
}

function readTSSistema(r) {
  const d = readTSDescricao(r);
  d._class = 'TSSistema';
  if (r.version > 1007) {
    d.occurrenceSys = r.readString();
    d.onOccurrence = readTSRule(r);
  }
  return d;
}

function readTSFormula(r) {
  const d = readTSDescricao(r);
  d._class = 'TSFormula';
  if (r.version >= 1100) d.typeVar = r.readInteger();
  return d;
}

function readTSEspecial(r) {
  const d = readTSDescricao(r);
  d._class = 'TSEspecial';
  d.specialKind = r.readInteger();
  d.totalLevel = r.readInteger();
  d.breakLevel = r.readInteger();
  d.tableField = r.readString();
  d.specialPicture = r.readString();
  d.result = r.readInteger();
  if (r.version >= 2031) d.printActualLevel = r.readBoolean();
  return d;
}

function readTSGrafico(r) {
  const d = readTSDescricao(r);
  d._class = 'TSGrafico';
  // TSGraph.readDisk — format unknown, try best-effort skip
  d._graphOpaque = true;
  d._graphError = 'TSGraph format not decompiled — cannot parse further';
  return d;
}

function readTSGrade(r) {
  const d = readTSDescricao(r);
  d._class = 'TSGrade';
  d.pen = r.readPen();
  d.gradeExport = readTFExportClass(r);
  d.lineSize = r.readInteger();
  d.colSize = r.readInteger();
  d.qtdLine = r.readInteger();
  d.qtdCol = r.readInteger();
  d.autoSize = r.readBoolean();
  d.totalSize = r.readInteger();
  d.sectionSpace = r.readInteger();
  r.readInteger(); // discarded
  r.readInteger(); // discarded
  r.readString();  // discarded
  r.readString();  // discarded
  r.readString();  // discarded
  r.readString();  // discarded
  d.generalSize = r.readBoolean();
  d.breakInLine = r.readBoolean();
  r.readBoolean(); // discarded
  r.readBoolean(); // discarded
  return d;
}

function readTSDesenho(r) {
  const d = readTSDescricao(r);
  d._class = 'TSDesenho';
  d.shape = r.readInteger();
  d.brush = r.readBrush();
  d.pen = r.readPen();
  if (r.version >= 1100) d.export = readTFExportClass(r);
  if (r.version >= 2006) d.autoAdjustBottom = r.readBoolean();
  return d;
}

function readTSMemoran(r) {
  const m = { _class: 'TSMemoran' };
  m.top = r.readInteger();
  m.left = r.readInteger();
  m.width = r.readInteger();
  m.height = r.readInteger();
  m.name = r.readString();
  m.color = r.readInteger();
  m.font = r.readFont();
  m.maxLength = r.readInteger();
  m.canPrint = r.readBoolean();
  m.wordWrap = r.readBoolean();
  if (r.version > 1021) m.autoSize = r.readBoolean();
  if (r.version <= 1003) {
    r.readString(); // discard legacy
  }
  if (r.version > 1003) {
    m.table = r.readString();
    m.field = r.readString();
  }
  if (r.version > 1025) {
    m.displayEntrance = r.readBoolean();
    m.displayOrder = r.readBoolean();
  }
  if (r.version >= 1100) {
    m.export = readTFExportClass(r);
  }
  // Memo text
  if (r.version >= 2058) {
    m.text = r.readString();
  } else {
    m.lines = [];
    r.readListBegin();
    while (!r.endOfList()) {
      m.lines.push(r.readString());
    }
    r.readListEnd();
    m.text = m.lines.join('\n');
  }
  m.onPrint = readTSRule(r);
  if (r.version > 1114) m.transparent = r.readBoolean();
  // Style flags (version >= 2000 or 1115, with peek check)
  if ((r.version >= 2000 || r.version === 1115) &&
      (r.peekByte() === VT.vaFalse || r.peekByte() === VT.vaTrue)) {
    m.expanded = r.readBoolean();
    m.compressed = r.readBoolean();
    m.underlined = r.readBoolean();
    m.italic = r.readBoolean();
    m.boldface = r.readBoolean();
  }
  if (r.version >= 2023) m.justify = r.readInteger();
  if (r.version >= 2036) m.cascadeCharCase = r.readRawByte();
  return m;
}

function readTSImagem(r) {
  const img = { _class: 'TSImagem' };
  img.top = r.readInteger();
  img.left = r.readInteger();
  img.width = r.readInteger();
  img.height = r.readInteger();
  img.name = r.readString();
  img.autoSize = r.readBoolean();
  img.center = r.readBoolean();
  img.stretch = r.readBoolean();
  img.canPrint = r.readBoolean();
  if (r.version > 1002) img.tableField = r.readString();
  if (r.version >= 1100) img.export = readTFExportClass(r);
  if (r.version > 1016) {
    img.connectList = [];
    r.readListBegin();
    while (!r.endOfList()) {
      img.connectList.push(r.readString());
    }
    r.readListEnd();
  }
  img.onPrint = readTSRule(r);
  if (r.version <= 1001) {
    r.readString(); // discard legacy
  }
  if (r.version > 1001) {
    if (r.version < 1113) {
      // legacy bitmap
      const size = r.readInteger();
      if (size > 0) r.skipBytes(size);
      img.imageType = 'bitmap';
      img.imageSize = size;
    } else {
      img.image = r.readImage();
    }
    if (r.version >= 2022) {
      img.transparency = r.readImage();
    }
  }
  if (r.version >= 2009) img.resizeSection = r.readBoolean();
  return img;
}

function readTSCodBarra(r) {
  const cb = { _class: 'TSCodBarra' };
  cb.name = r.readString();
  cb.top = r.readInteger();
  cb.left = r.readInteger();
  cb.width = r.readInteger();
  cb.height = r.readInteger();
  cb.color = r.readInteger();
  cb.font = r.readFont();
  cb.canPrint = r.readBoolean();
  cb.visible = r.readBoolean();
  cb.autoSize = r.readBoolean();
  cb.autoSizeFont = r.readBoolean();
  cb.barCodeType = r.readInteger();
  cb.barColor = r.readInteger();
  cb.barWidth = r.readFloat();
  cb.bearerBars = r.readBoolean();
  cb.calcCheckDigit = r.readBoolean();
  cb.data = r.readString();
  cb.fontAlignment = r.readInteger();
  cb.orientation = r.readInteger();
  cb.printHumanReadable = r.readBoolean();
  cb.wideBarRatio = r.readFloat();
  cb.tableField = r.readString();
  cb.fillCharacter = r.readString();
  if (r.version >= 1100) cb.export = readTFExportClass(r);
  cb.onPrint = readTSRule(r);
  if (r.version >= 2007) cb.isBMPFormat = r.readBoolean();
  if (r.version < 2018 && cb.isBMPFormat !== undefined) cb.isBMPFormat = true;
  if (r.version >= 2011) {
    cb.backgroundColor = r.readInteger();
    cb.borderSize = r.readInteger();
    r.readInteger(); // discarded
    r.readInteger(); // discarded
  }
  return cb;
}

function readTSQRCode(r) {
  const qr = { _class: 'TSQRCode' };
  qr.name = r.readString();
  qr.size = r.readInteger();
  qr.canPrint = r.readBoolean();
  qr.top = r.readInteger();
  qr.left = r.readInteger();
  qr.data = r.readString();
  qr.tableField = r.readString();
  qr.export = readTFExportClass(r);
  qr.margin = r.readInteger();
  qr.onPrint = readTSRule(r);
  return qr;
}

function readImgVetorial(r) {
  // TSImgVetorial — extends TSBaseImage, similar to TSImagem
  // Fallback: try same as TSImagem
  return readTSImagem(r);
}

// ─── TSDetail (extends TSBand with additional fields) ────────────────────────
function readTSDetail(r) {
  const band = readTSBand(r);
  band._class = 'TSDetail';
  const detailStart = r.pos;
  try {
    band.connectBandName = r.readString();
    band.interpolate = r.readBoolean();
    band.order = r.readInteger();
    band.baseTable = r.readString();
    // classification.readDisk — unknown format, try skip
    // relationList.readDisk — unknown format
    // relationParentList.readDisk — unknown format
    // Scan forward to FINAL SECAO
    const finalSecaoBuf = Buffer.from('FINAL SECAO', 'latin1');
    for (let i = r.pos; i < r.buf.length - finalSecaoBuf.length - 2; i++) {
      if (r.buf[i] === VT.vaString && r.buf[i + 1] === finalSecaoBuf.length &&
          r.buf.subarray(i + 2, i + 2 + finalSecaoBuf.length).equals(finalSecaoBuf)) {
        r.errors.push({
          component: 'TSDetail-extra',
          offset: detailStart,
          skippedTo: i,
          note: `Skipped ${i - r.pos} bytes (classification+relations)`
        });
        r.pos = i;
        return band;
      }
    }
  } catch (e) {
    r.errors.push({ component: 'TSDetail', offset: detailStart, error: e.message });
  }
  return band;
}

// ─── TSBand ──────────────────────────────────────────────────────────────────
function readTSBand(r) {
  const band = { _class: 'TSBand' };
  band.top = r.readInteger();
  band.left = r.readInteger();
  band.width = r.readInteger();
  band.height = r.readInteger();
  band.name = r.readString();
  r.readString(); // caption — discarded
  band.color = r.readInteger();
  band.font = r.readFont();
  band.tag = r.readInteger();
  band.pageJump = r.readRawByte();
  band.bandBreak = r.readString();
  band.canPrint = r.readBoolean();
  if (r.version > 1013) band.linkBand = r.readString();
  if (r.version >= 1100) {
    band.befPrintHTML = r.readInteger();
    band.aftPrintHTML = r.readInteger();
  }
  if (r.version >= 2036) band.cascadeCharCase = r.readRawByte();

  // Table list
  band.tableList = [];
  r.readListBegin();
  while (!r.endOfList()) {
    band.tableList.push(r.readString());
  }
  r.readListEnd();

  // Frame
  band.frame = readTSFrameDef(r);

  // Background picture
  if (r.version > 1017) {
    if (r.version < 2004) {
      const size = r.readInteger();
      if (size > 0) {
        r.skipBytes(size);
        band.backgroundType = 'bitmap';
        band.backgroundSize = size;
      }
    } else {
      const picType = r.readInteger();
      if (picType !== 0) {
        const size = r.readInteger();
        r.skipBytes(size);
        band.backgroundType = ['none', 'bitmap', 'jpeg', 'icon', 'metafile'][picType] || `unknown(${picType})`;
        band.backgroundSize = size;
      }
    }
  }

  // Style flags
  if (r.version > 1018) {
    band.expanded = r.readBoolean();
    band.compressed = r.readBoolean();
    band.underlined = r.readBoolean();
    band.italic = r.readBoolean();
    band.boldface = r.readBoolean();
  }

  // Export class
  if (r.version >= 1100) {
    band.export = readTFExportClass(r);
  }

  // Rules
  band.onBeforePrint = readTSRule(r);
  band.onAfterPrint = readTSRule(r);

  // Child controls
  band.children = [];
  r.readListBegin();
  while (!r.endOfList()) {
    const className = r.readString();
    const startPos = r.pos;
    if (r._debug) console.error(`[DEBUG] @0x${startPos.toString(16)}: band=${band.name} child=${className}`);
    try {
      const child = readControl(r, className);
      band.children.push(child);
    } catch (e) {
      r.errors.push({ band: band.name, control: className, offset: startPos, error: e.message });
      // Cannot recover — stop reading this band's children
      break;
    }
  }
  // Try to read list end (may have broken out of loop)
  if (r.peekByte() === VT.vaNull) r.readListEnd();

  // Classify band type from tag
  band.bandType = classifyBandTag(band.tag);

  return band;
}

function classifyBandTag(tag) {
  // Tag ranges from SenGlbPf.pickBandType
  // Small tags (0-99) are used for sequential band numbering in some models
  if (tag === 0) return 'TITULO';
  if (tag >= 1 && tag <= 99) return 'CABECALHO';
  if (tag >= 101 && tag <= 199) return 'TITULO';
  if (tag >= 200 && tag <= 299) return 'DETALHE';
  if (tag >= 300 && tag <= 399) return 'SUBTOTAL';
  if (tag >= 400 && tag <= 499) return 'SUBTITULO';
  if (tag >= 500 && tag <= 502) return 'ADICIONAL';
  if (tag === 503) return 'RODAPE';
  if (tag >= 600 && tag <= 699) return 'OUTRO';
  return `TAG_${tag}`;
}

function readControl(r, className) {
  const dispatch = {
    'TSDescricao':  readTSDescricao,
    'TSCadastro':   readTSCadastro,
    'TSTotal':      readTSTotal,
    'TSSistema':    readTSSistema,
    'TSFormula':    readTSFormula,
    'TSEspecial':   readTSEspecial,
    'TSGrafico':    readTSGrafico,
    'TSGrade':      readTSGrade,
    'TSDesenho':    readTSDesenho,
    'TSMemoran':    readTSMemoran,
    'TSImagem':     readTSImagem,
    'TSBaseImage':  readTSImagem,
    'TSCodBarra':   readTSCodBarra,
    'TSQRCode':     readTSQRCode,
    'TSImgVetorial': readImgVetorial,
  };
  const fn = dispatch[className];
  if (!fn) {
    throw new ParseError(`Unknown control class: ${className}`, r.pos);
  }
  return fn(r);
}

// ─── TSConfigPage (opaque — skip by scanning for next known marker) ──────────
function skipTSConfigPage(r) {
  // TSConfigPage format uses extended floats for paper dimensions — not decompiled.
  // Strategy: scan forward for (vaFalse|vaTrue) + vaList which marks
  // insertSpace + description list start (always follows TSConfigPage).
  const startPos = r.pos;
  for (let i = r.pos; i < r.buf.length - 3; i++) {
    const b = r.buf[i];
    // Look for boolean (vaFalse=0x08 or vaTrue=0x09) followed by vaList(0x01) followed by vaString(0x06)
    if ((b === VT.vaFalse || b === VT.vaTrue) &&
        r.buf[i + 1] === VT.vaList &&
        r.buf[i + 2] === VT.vaString) {
      r.pos = i;
      r.errors.push({ component: 'TSConfigPage', offset: startPos, skippedTo: i,
                       note: `Skipped ${i - startPos} bytes (opaque)` });
      return { _opaque: true, skippedBytes: i - startPos };
    }
  }
  // Fallback: couldn't find marker, stay where we are
  r.errors.push({ component: 'TSConfigPage', offset: startPos, error: 'Could not find post-ConfigPage marker' });
  return { _opaque: true };
}

// ─── TgrOutParametes (opaque — skip by scanning for INICIO SECAO) ───────────
function skipTgrOutParametes(r) {
  // TgrOutParametes format unknown. Scan for "INICIO SECAO" or "FINAL MODELO"
  // which marks the start of the band loop (always follows OutputDefs).
  const startPos = r.pos;
  const markers = ['INICIO SECAO', 'FINAL MODELO'];
  for (const marker of markers) {
    const markerBuf = Buffer.from(marker, 'latin1');
    for (let i = r.pos; i < r.buf.length - markerBuf.length - 2; i++) {
      if (r.buf[i] === VT.vaString && r.buf[i + 1] === markerBuf.length &&
          r.buf.subarray(i + 2, i + 2 + markerBuf.length).equals(markerBuf)) {
        r.pos = i;
        r.errors.push({ component: 'TgrOutParametes', offset: startPos, skippedTo: i,
                         note: `Skipped ${i - startPos} bytes to ${marker}` });
        return { _opaque: true, skippedBytes: i - startPos };
      }
    }
  }
  r.errors.push({ component: 'TgrOutParametes', offset: startPos, error: 'Could not find band loop marker' });
  return { _opaque: true };
}

// ─── Break List ──────────────────────────────────────────────────────────────
function readBreakList(r) {
  const breaks = [];
  r.readListBegin();
  while (!r.endOfList()) {
    const brk = {};
    brk.fieldName = r.readString();
    brk.tableName = r.readString();
    brk.bandName = r.readString();
    brk.footerBandName = r.readString();
    if (r.version > 1009) brk.resetPageOnBreak = r.readBoolean();
    if (r.version >= 2020) brk.printFooterNewPage = r.readBoolean();
    breaks.push(brk);
  }
  r.readListEnd();
  return breaks;
}

// ─── Main Parser: readReportClass ────────────────────────────────────────────
function parseReportClass(r) {
  const model = {};

  // 1. Sentinel
  const sentinel = r.readString();
  if (sentinel !== 'INICIO MODELO') {
    throw new ParseError(`Expected "INICIO MODELO", got "${sentinel}"`, 0);
  }

  // 2. Binary version
  // NOTE: binaryVersion is metadata about when the model was created.
  // The actual format version comes from fHeader.version (set in readGeneralInfos,
  // which ran before the payload was written). Since .raw files don't include the
  // header, we use the maximum known version (2061) and detect/recover on mismatch.
  // A --version CLI flag can override this.
  const binaryVersion = r.readInteger();
  model.binaryVersion = binaryVersion;
  if (!r.version) r.version = 2061; // default to max known version
  model.version = r.version;

  // 3. System var version
  if (r.version > 1029) {
    model.systemVarVersion = r.readInteger();
  }

  // 4. useSQLSenior2
  if (r.version >= 2002) {
    model.useSQLSenior2 = r.readBoolean();
  }

  // 5-9. Caption + geometry
  model.caption = r.readString();
  model.top = r.readInteger();
  model.left = r.readInteger();
  model.width = r.readInteger();
  model.height = r.readInteger();

  // 10-11. VER_ORIGEM (optional)
  if (r.nextValue() === VT.vaIdent) {
    const ident = r.readIdent();
    if (ident === 'VER_ORIGEM') {
      model.logicalExecVersion = r.readInteger();
    }
  }

  // 12. Font
  model.font = r.readFont();

  // 13-15. Pixel metrics
  if (r.version >= 1101) model.pixPerInch = r.readInteger();
  if (r.version >= 1102) {
    model.carWidth = r.readInteger();
    model.carHeight = r.readInteger();
  }

  // 16-19. Layout settings
  model.color = r.readInteger();
  model.beginLeftBorder = r.readInteger();
  model.numberImages = r.readInteger();
  model.betweenImages = r.readInteger();
  if (r.version >= 2019) model.orderLineImages = r.readBoolean();
  model.maxReportLines = r.readInteger();
  model.maxColumns = r.readInteger();
  model.layoutDefault = r.readRawByte();
  model.saveEntrance = r.readBoolean();
  model.orientation = r.readRawByte();
  model.reportType = r.readRawByte();
  model.titleBeforeHeader = r.readBoolean();
  model.formatReport = r.readRawByte();
  model.preparation = r.readBoolean();

  if (r.version > 1000) model.lines18 = r.readBoolean();
  if (r.version > 1012) model.uniqueSQL = r.readBoolean();
  if (r.version > 1019) {
    model.pxIncrement = r.readInteger();
    model.pyIncrement = r.readInteger();
  }
  if (r.version > 1026) model.printEmptyReport = r.readBoolean();
  if (r.version > 1027) model.printGroupHeaders = r.readBoolean();

  if (r.version >= 1037 && !(r.version >= 1100 && r.version <= 1103)) {
    model.consistModel = r.readBoolean();
  }
  if (r.version >= 1100) model.saveDefinitions = r.readBoolean();
  if (r.version >= 2025) model.useLanguageSeparators = r.readBoolean();
  if (r.version >= 2030) model.useDuplexMode = r.readBoolean();
  if (r.version >= 1100) model.groupEmbrance = r.readString();
  if (r.version >= 2005) model.beforeBandRules = r.readBoolean();
  if (r.version >= 2014) model.pageFooterEndPage = r.readBoolean();

  if (r.version >= 2047 && (r.peekByte() === VT.vaFalse || r.peekByte() === VT.vaTrue)) {
    model.titleFooterEndPage = r.readBoolean();
  }

  if (r.version >= 2036) model.cascadeCharCase = r.readRawByte();
  if (r.version >= 2039) model.showEntranceReportService = r.readRawByte();
  if (r.version >= 2046) model.useConfReg = r.readBoolean();

  // Config page
  if (r.version > 1028) {
    const hasCfgPage = r.readBoolean();
    if (hasCfgPage) {
      model.configPage = skipTSConfigPage(r);
    }
  }

  if (r.version >= 1100) model.insertSpace = r.readBoolean();

  // Model description
  model.description = [];
  r.readListBegin();
  while (!r.endOfList()) {
    model.description.push(r.readString());
  }
  r.readListEnd();

  if (r.version >= 2013) model.longName = r.readString();

  if (r._debug) console.error(`[DEBUG] @0x${r.pos.toString(16)}: pre-rules`);

  // Rule code sections
  model.sections = {};
  if (r.version > 1005) {
    // Table lists
    model.tableSelection = readStringList(r);
    model.tableInit = readStringList(r);
    if (r.version >= 1036 && !(r.version >= 1100 && r.version <= 1103)) {
      model.tableFinalization = readStringList(r);
      model.tableFunctions = readStringList(r);
    }

    // Rule sections
    model.sections.preambleSelect = readTSRule(r);
    model.sections.selection = readTSRule(r);
    model.sections.initialization = readTSRule(r);

    if (r.version >= 1036 && !(r.version >= 1100 && r.version <= 1103)) {
      model.sections.finalization = readTSRule(r);
      model.sections.functionRule = readTSRule(r);
    }
  }

  if (r.version >= 2030) {
    model.sections.printPage = readTSRule(r);
  }

  if (r._debug) console.error(`[DEBUG] @0x${r.pos.toString(16)}: pre-entrance`);

  // ─── Skip to band section ─────────────────────────────────────────────
  // The entrance component (TSEntranceList), logicalBuffer, breakList,
  // export params, PDF properties, and output defs use classes not fully
  // decompiled. Instead of parsing them, scan forward to the band loop
  // marker "INICIO SECAO" (or "FINAL MODELO" for empty reports).
  {
    const entranceStart = r.pos;
    const inicioSecao = Buffer.from('INICIO SECAO', 'latin1');
    const finalModelo = Buffer.from('FINAL MODELO', 'latin1');
    let foundAt = -1;
    for (let i = r.pos; i < r.buf.length - inicioSecao.length - 2; i++) {
      if (r.buf[i] === VT.vaString) {
        const len = r.buf[i + 1];
        if (len === inicioSecao.length &&
            r.buf.subarray(i + 2, i + 2 + len).equals(inicioSecao)) {
          foundAt = i;
          break;
        }
        if (len === finalModelo.length &&
            r.buf.subarray(i + 2, i + 2 + len).equals(finalModelo)) {
          foundAt = i;
          break;
        }
      }
    }
    if (foundAt >= 0) {
      r.pos = foundAt;
      r.errors.push({
        component: 'pre-band-skip',
        offset: entranceStart,
        skippedTo: foundAt,
        note: `Skipped ${foundAt - entranceStart} bytes (entrance+logicalBuffer+breakList+exports+outputDefs)`
      });
    } else {
      throw new ParseError('Could not find band section (INICIO SECAO / FINAL MODELO)', r.pos);
    }
  }

  // ─── Band loop ───────────────────────────────────────────────────────
  model.bands = [];
  let bandErrors = 0;
  while (r.remaining() > 0) {
    const className = r.readString();
    if (className === 'FINAL MODELO') break;
    if (className === 'INICIO SECAO') {
      const bandClassName = r.readString(); // should be band class name
      if (r._debug) console.error(`[DEBUG] @0x${r.pos.toString(16)}: INICIO SECAO bandClass=${bandClassName}`);
      const bandStartPos = r.pos;
      try {
        const band = bandClassName === 'TSDetail' ? readTSDetail(r) : readTSBand(r);
        model.bands.push(band);
      } catch (e) {
        bandErrors++;
        r.errors.push({ section: 'band', offset: bandStartPos, error: e.message });
        if (bandErrors > 3) break; // too many errors, stop
        // Try to find next section marker
        if (!seekToMarker(r, 'FINAL SECAO') && !seekToMarker(r, 'INICIO SECAO')) break;
        continue;
      }
      // Read FINAL SECAO
      try {
        const finalSecao = r.readString();
        if (finalSecao !== 'FINAL SECAO') {
          r.errors.push({ section: 'band', error: `Expected "FINAL SECAO", got "${finalSecao}"` });
        }
      } catch (e) {
        // May have already consumed it during error recovery
      }
    } else {
      r.errors.push({ section: 'band', error: `Unexpected section marker: "${className}"` });
      break;
    }
  }

  return model;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readStringList(r) {
  const list = [];
  r.readListBegin();
  while (!r.endOfList()) {
    list.push(r.readString());
  }
  r.readListEnd();
  return list;
}

// Skip a DFM-style embedded component (sEntrance)
function skipDFMComponent(r) {
  // DFM component starts with TPF0 signature (0x30465054)
  // Then: readStr(className), readStr(instanceName), properties until vaNull, children until vaNull
  const sig = r.readRawInt();
  if (sig !== 0x30465054) {
    // Not a TPF0 signature — might be a null component
    // Rewind 4 bytes and check if it's a vaNull or integer
    r.pos -= 4;
    // Check if this is just an empty entrance (next tag is an integer for logicalSize)
    return;
  }
  skipDFMObject(r);
}

function skipDFMObject(r) {
  // readStr (className)
  r.readStr();
  // readStr (instanceName)
  r.readStr();
  // Properties: loop readStr(propName) + readValue until propName is empty
  while (true) {
    const propName = r.readStr();
    if (propName === '') break;
    skipDFMValue(r);
  }
  // Children: loop readDFMObject until vaNull
  while (r.peekByte() !== VT.vaNull) {
    skipDFMObject(r);
  }
  r.readRawByte(); // consume vaNull
}

function skipDFMValue(r) {
  const tag = r.readRawByte();
  switch (tag) {
    case VT.vaNull: break;
    case VT.vaList:
      while (r.peekByte() !== VT.vaNull) skipDFMValue(r);
      r.readRawByte();
      break;
    case VT.vaInt8:  r.pos += 1; break;
    case VT.vaInt16: r.pos += 2; break;
    case VT.vaInt32: r.pos += 4; break;
    case VT.vaExtended: r.pos += 10; break;
    case VT.vaString: { const len = r.readRawByte(); r.pos += len; break; }
    case VT.vaIdent: { const len = r.readRawByte(); r.pos += len; break; }
    case VT.vaFalse: break;
    case VT.vaTrue: break;
    case VT.vaBinary: { const len = r.readRawInt(); r.pos += len; break; }
    case VT.vaSet:
      while (true) {
        const len = r.readRawByte();
        if (len === 0) break;
        r.pos += len;
      }
      break;
    case VT.vaLString: { const len = r.readRawInt(); r.pos += len; break; }
    case VT.vaNil: break;
    case VT.vaCollection:
      while (r.peekByte() !== VT.vaNull) {
        skipDFMValue(r); // item header (usually vaList + properties)
      }
      r.readRawByte();
      break;
    case VT.vaSingle: r.pos += 4; break;
    case VT.vaCurrency: r.pos += 8; break;
    case VT.vaDate: r.pos += 8; break;
    case VT.vaWString: { const len = r.readRawInt(); r.pos += len * 2; break; }
    case VT.vaInt64: r.pos += 8; break;
    default:
      throw new ParseError(`skipDFMValue: unknown tag 0x${tag.toString(16)}`, r.pos - 1);
  }
}

// Skip PDF properties (format unknown, heuristic)
function skipPDFProperties(r) {
  const startPos = r.pos;
  try {
    const pdf = {};
    pdf.title = r.readString();
    pdf.author = r.readString();
    pdf.subject = r.readString();
    pdf.keywords = r.readString();
    pdf.creator = r.readString();
    if (r.version >= 2032) pdf.openPassword = r.readString();
    if (r.version >= 2032) pdf.ownerPassword = r.readString();
    if (r.version >= 2042) pdf.embedFonts = r.readBoolean();
    return pdf;
  } catch (e) {
    r.pos = startPos;
    r.errors.push({ component: 'PDFProperties', offset: startPos, error: e.message });
    return { _opaque: true };
  }
}

// Seek forward to find a string marker (error recovery)
function seekToMarker(r, marker) {
  const markerBytes = Buffer.from(marker, 'latin1');
  const searchFrom = r.pos;
  for (let i = searchFrom; i < r.buf.length - markerBytes.length - 2; i++) {
    // Look for vaString tag + length + marker
    if (r.buf[i] === VT.vaString && r.buf[i + 1] === markerBytes.length) {
      if (r.buf.subarray(i + 2, i + 2 + markerBytes.length).equals(markerBytes)) {
        r.pos = i;
        return true;
      }
    }
  }
  return false;
}

// ─── Fallback: parse only bands (skip header) ────────────────────────────────
function parseBandsOnly(r) {
  const model = { _bandsOnly: true, sections: {} };

  // Extract binaryVersion from start
  for (let i = 0; i < Math.min(r.buf.length, 30); i++) {
    if (r.buf[i] === 0x06 && r.buf[i + 1] === 0x0d &&
        r.buf.subarray(i + 2, i + 15).toString('latin1') === 'INICIO MODELO') {
      const tag = r.buf[i + 15];
      if (tag === 0x03) model.binaryVersion = r.buf.readUInt16LE(i + 16);
      else if (tag === 0x04) model.binaryVersion = r.buf.readInt32LE(i + 16);
      break;
    }
  }

  // Scan to first INICIO SECAO
  const marker = Buffer.from('INICIO SECAO', 'latin1');
  for (let i = 0; i < r.buf.length - marker.length - 2; i++) {
    if (r.buf[i] === VT.vaString && r.buf[i + 1] === marker.length &&
        r.buf.subarray(i + 2, i + 2 + marker.length).equals(marker)) {
      r.pos = i;
      break;
    }
  }

  r.errors.push({ component: 'header', note: 'Header skipped — bands-only fallback' });

  // Band loop (same as parseReportClass)
  model.bands = [];
  let bandErrors = 0;
  while (r.remaining() > 0) {
    const className = r.readString();
    if (className === 'FINAL MODELO') break;
    if (className === 'INICIO SECAO') {
      const bandClassName = r.readString();
      const bandStartPos = r.pos;
      try {
        const band = bandClassName === 'TSDetail' ? readTSDetail(r) : readTSBand(r);
        model.bands.push(band);
      } catch (e) {
        bandErrors++;
        r.errors.push({ section: 'band', offset: bandStartPos, error: e.message });
        if (bandErrors > 3) break;
        if (!seekToMarker(r, 'FINAL SECAO') && !seekToMarker(r, 'INICIO SECAO')) break;
        continue;
      }
      try {
        const finalSecao = r.readString();
        if (finalSecao !== 'FINAL SECAO') {
          r.errors.push({ section: 'band', error: `Expected "FINAL SECAO", got "${finalSecao}"` });
        }
      } catch (e) {}
    } else {
      r.errors.push({ section: 'band', error: `Unexpected: "${className}"` });
      break;
    }
  }
  return model;
}

// ─── Post-processing: extract tables and SQL ─────────────────────────────────

function extractMetadata(model) {
  const tables = new Set();
  const sqlFragments = [];

  // From table lists
  for (const list of [model.tableSelection, model.tableInit, model.tableFinalization, model.tableFunctions]) {
    if (list) list.forEach(s => {
      const match = s.match(/\b[RE]\d{3}\w+/gi);
      if (match) match.forEach(t => tables.add(t.toUpperCase()));
    });
  }

  // From rule sections
  for (const [, rule] of Object.entries(model.sections || {})) {
    if (rule && rule.source) {
      const tblMatches = rule.source.match(/\b[RE]\d{3}\w+/gi);
      if (tblMatches) tblMatches.forEach(t => tables.add(t.toUpperCase()));
      const sqlMatches = rule.source.match(/(?:SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|WHERE)[\s\S]*?;/gi);
      if (sqlMatches) sqlFragments.push(...sqlMatches);
    }
  }

  // From band fields
  for (const band of model.bands || []) {
    for (const child of band.children || []) {
      if (child.table) tables.add(child.table.toUpperCase());
      if (child.tableField) {
        const parts = child.tableField.split('.');
        if (parts[0]) tables.add(parts[0].toUpperCase());
      }
    }
    for (const t of band.tableList || []) {
      tables.add(t.toUpperCase());
    }
  }

  return {
    tablesReferenced: [...tables].sort(),
    sqlFragments,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseFile(filePath, version, debug) {
  const buf = fs.readFileSync(filePath);

  // Extract binaryVersion for fallback
  let binaryVersion = 0;
  for (let i = 0; i < Math.min(buf.length, 30); i++) {
    if (buf[i] === 0x06 && buf[i + 1] === 0x0d &&
        buf.subarray(i + 2, i + 15).toString('latin1') === 'INICIO MODELO') {
      const tag = buf[i + 15];
      if (tag === 0x02) binaryVersion = buf[i + 16];
      else if (tag === 0x03) binaryVersion = buf.readUInt16LE(i + 16);
      else if (tag === 0x04) binaryVersion = buf.readInt32LE(i + 16);
      break;
    }
  }

  // Try versions at every critical threshold where form-level fields change
  const versions = version ? [version] :
    [2061, 2060, 2057, 2056, 2055, 2049, 2048, 2047, 2046, 2044, 2039, 2036, 2030,
     2029, 2025, 2024, 2019, 2018, 2016, 2014, 2013, 2005, 2004, 2002, 2001,
     1108, 1107, 1102, 1101, 1100, 1099, 1037, 1036, 1029, 1028, 1020, 1013, 1001]
    .filter((v, i, a) => a.indexOf(v) === i);
  let lastError;

  let bestPos = -1;

  for (const ver of versions) {
    try {
      const reader = new TSReader(buf);
      reader.version = ver;
      if (debug) reader._debug = true;
      const model = parseReportClass(reader);
      const meta = extractMetadata(model);
      model.tablesReferenced = meta.tablesReferenced;
      model.sqlFragments = meta.sqlFragments;
      model._parseErrors = reader.errors;
      model._parsedBytes = reader.pos;
      model._totalBytes = buf.length;
      model._parseComplete = true;
      model._effectiveVersion = ver;
      return model;
    } catch (e) {
      const errOffset = e.offset || 0;
      if (errOffset > bestPos) {
        bestPos = errOffset;
        lastError = e;
        if (errOffset > 256) break;
      }
    }
  }

  // Fallback: skip header entirely, parse only bands
  try {
    const reader = new TSReader(buf);
    reader.version = 2061;
    if (debug) reader._debug = true;
    const model = parseBandsOnly(reader);
    const meta = extractMetadata(model);
    model.tablesReferenced = meta.tablesReferenced;
    model.sqlFragments = meta.sqlFragments;
    model._parseErrors = reader.errors;
    model._parsedBytes = reader.pos;
    model._totalBytes = buf.length;
    model._parseComplete = true;
    model._effectiveVersion = 'bands-only';
    return model;
  } catch (e2) {
    // Both approaches failed
  }
  throw lastError;
}

function formatOutput(model, filePath) {
  return {
    filename: path.basename(filePath).replace(/\.raw$/i, '.GER'),
    version: model.version,
    systemVarVersion: model.systemVarVersion,
    caption: model.caption,
    title: (model.description || []).join(' ').replace(/^&/, ''),
    description: model.description,
    orientation: ['Portrait', 'Landscape'][model.orientation] || `Unknown(${model.orientation})`,
    reportType: model.reportType,
    formatReport: model.formatReport,
    sections: Object.fromEntries(
      Object.entries(model.sections || {}).map(([k, v]) => [k, v.source || ''])
    ),
    bands: (model.bands || []).map(b => ({
      name: b.name,
      bandType: b.bandType,
      tag: b.tag,
      position: { top: b.top, left: b.left, width: b.width, height: b.height },
      canPrint: b.canPrint,
      tableList: b.tableList,
      onBeforePrint: b.onBeforePrint?.source || '',
      onAfterPrint: b.onAfterPrint?.source || '',
      children: (b.children || []).map(c => {
        const child = {
          type: c._class,
          name: c.name,
          position: { top: c.top, left: c.left, width: c.width, height: c.height },
        };
        if (c.table) child.table = c.table;
        if (c.field) child.field = c.field;
        if (c.tableField) child.tableField = c.tableField;
        if (c.caption) child.caption = c.caption;
        if (c.fieldName) child.fieldName = c.fieldName;
        if (c.fieldList) child.fieldList = c.fieldList;
        if (c.onPrint?.source) child.onPrint = c.onPrint.source;
        if (c.font) child.font = { name: c.font.name, size: c.font.size };
        return child;
      }),
    })),
    tablesReferenced: model.tablesReferenced,
    sqlFragments: model.sqlFragments,
    breakList: model.breakList,
    _stats: {
      parsedBytes: model._parsedBytes,
      totalBytes: model._totalBytes,
      parseComplete: model._parseComplete,
      bandCount: (model.bands || []).length,
      fieldCount: (model.bands || []).reduce((n, b) => n + (b.children || []).length, 0),
      errorCount: (model._parseErrors || []).length,
      errors: model._parseErrors,
    },
  };
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`Usage:
  node tools/ParseGer.js <file.raw>                  Parse single file
  node tools/ParseGer.js --batch <indir> <outdir>    Batch parse
  node tools/ParseGer.js --summary <file.raw>        Metadata only
  node tools/ParseGer.js --stats <dir>               Parse stats for dir`);
    process.exit(0);
  }

  if (args[0] === '--batch') {
    const inDir = args[1];
    const outDir = args[2];
    if (!inDir || !outDir) { console.error('Usage: --batch <indir> <outdir>'); process.exit(1); }
    fs.mkdirSync(outDir, { recursive: true });
    const files = fs.readdirSync(inDir).filter(f => f.endsWith('.raw'));
    let ok = 0, fail = 0, partial = 0;
    for (const file of files) {
      const inPath = path.join(inDir, file);
      const outPath = path.join(outDir, file.replace(/\.raw$/i, '.json'));
      try {
        const model = parseFile(inPath);
        const output = formatOutput(model, inPath);
        fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
        if (output._stats.parseComplete) ok++;
        else { partial++; }
      } catch (e) {
        fail++;
        // Write error file
        fs.writeFileSync(outPath, JSON.stringify({ error: e.message, file }, null, 2));
      }
    }
    console.log(`Batch complete: ${files.length} files — ${ok} OK, ${partial} partial, ${fail} failed`);
    process.exit(fail > files.length / 2 ? 1 : 0);

  } else if (args[0] === '--summary') {
    const filePath = args[1];
    try {
      const model = parseFile(filePath);
      const out = formatOutput(model, filePath);
      console.log(`File: ${out.filename}`);
      console.log(`Version: ${out.version}`);
      console.log(`Title: ${out.title}`);
      console.log(`Orientation: ${out.orientation}`);
      console.log(`Bands: ${out._stats.bandCount}`);
      console.log(`Fields: ${out._stats.fieldCount}`);
      console.log(`Tables: ${out.tablesReferenced.join(', ')}`);
      console.log(`Parse: ${out._stats.parsedBytes}/${out._stats.totalBytes} bytes (${out._stats.parseComplete ? 'COMPLETE' : 'PARTIAL'})`);
      if (out._stats.errorCount > 0) {
        console.log(`Errors: ${out._stats.errorCount}`);
        out._stats.errors.forEach(e => console.log(`  - ${JSON.stringify(e)}`));
      }
    } catch (e) {
      console.error(`FATAL: ${e.message}`);
      process.exit(1);
    }

  } else if (args[0] === '--stats') {
    const dir = args[1] || '.';
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.raw'));
    let ok = 0, partial = 0, fail = 0;
    const errors = {};
    for (const file of files) {
      try {
        const model = parseFile(path.join(dir, file));
        if (model._parseComplete) ok++;
        else partial++;
        for (const e of model._parseErrors || []) {
          const key = e.error?.substring(0, 60) || 'unknown';
          errors[key] = (errors[key] || 0) + 1;
        }
      } catch (e) {
        fail++;
        const key = e.message?.substring(0, 60) || 'unknown';
        errors[key] = (errors[key] || 0) + 1;
      }
    }
    console.log(`Stats for ${files.length} files: ${ok} OK, ${partial} partial, ${fail} failed`);
    if (Object.keys(errors).length > 0) {
      console.log('\nTop errors:');
      Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([msg, count]) => {
        console.log(`  ${count}× ${msg}`);
      });
    }

  } else {
    // Single file
    const filePath = args.find(a => !a.startsWith('--'));
    const debug = args.includes('--debug');
    const verFlag = args.find(a => a.startsWith('--version='));
    const ver = verFlag ? parseInt(verFlag.split('=')[1]) : null;
    try {
      const model = parseFile(filePath, ver, debug);
      const output = formatOutput(model, filePath);
      console.log(JSON.stringify(output, null, 2));
    } catch (e) {
      console.error(`FATAL: ${e.message}`);
      process.exit(1);
    }
  }
}

main();
