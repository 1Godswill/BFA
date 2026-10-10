/* ---------- Minimal pure-JS PDF writer ----------
   Builds a real, valid PDF entirely offline (no library, no network).
   Supports title/body text, two-column rows, rules, and an embedded JPEG logo,
   with automatic pagination. Mirrors the offline approach used in zip-writer.js
   for the Word (.docx) export. */

/* The two built-in fonts are declared with WinAnsiEncoding (Windows-1252), so every character is
   written as ONE byte of that code page. Before this, text went into the file as UTF-8, which
   made characters like the em dash (—) or accented letters come out as garbage. Characters that
   aren't in Windows-1252 print as "?". Output is plain ASCII (non-ASCII bytes as \ddd octal). */
const PDF_CP1252_EXTRA = {
  "€":0x80,"‚":0x82,"ƒ":0x83,"„":0x84,"…":0x85,"†":0x86,"‡":0x87,"ˆ":0x88,"‰":0x89,"Š":0x8A,"‹":0x8B,"Œ":0x8C,"Ž":0x8E,
  "‘":0x91,"’":0x92,"“":0x93,"”":0x94,"•":0x95,"–":0x96,"—":0x97,"˜":0x98,"™":0x99,"š":0x9A,"›":0x9B,"œ":0x9C,"ž":0x9E,"Ÿ":0x9F
};
function pdfEscText(s){
  s = String(s===undefined||s===null?"":s);
  let out = "";
  for(const ch of s){
    const cp = ch.codePointAt(0);
    let b;
    if(cp < 0x80 || (cp >= 0xA0 && cp <= 0xFF)) b = cp;
    else if(PDF_CP1252_EXTRA[ch] !== undefined) b = PDF_CP1252_EXTRA[ch];
    else b = 0x3F; // "?"
    if(b === 0x5C) out += "\\\\";
    else if(b === 0x28) out += "\\(";
    else if(b === 0x29) out += "\\)";
    else if(b >= 0x20 && b <= 0x7E) out += String.fromCharCode(b);
    else out += "\\" + b.toString(8).padStart(3,"0");
  }
  return out;
}

class PDFDoc {
  constructor(opts){
    opts = opts || {};
    this.pageWidth = opts.pageWidth || 612;
    this.pageHeight = opts.pageHeight || 792;
    this.marginX = opts.marginX || 54;
    this.marginTop = opts.marginTop || 56;
    this.marginBottom = opts.marginBottom || 56;
    this.logoBytes = opts.logoBytes || null;
    this.logoW = opts.logoW || 640;
    this.logoH = opts.logoH || 640;
    this.watermarkOpacity = opts.watermarkOpacity !== undefined ? opts.watermarkOpacity : 0.07;
    this._usesImage = !!(this.logoBytes && this.watermarkOpacity > 0);
    this.pages = [];
    this._newPage();
  }
  _newPage(){
    this.pages.push({ops: []});
    this.y = this.pageHeight - this.marginTop;
  }
  _ensureSpace(lineHeight){
    if(this.y - lineHeight < this.marginBottom) this._newPage();
  }
  text(x, str, opts){
    opts = opts || {};
    const size = opts.size || 11;
    const bold = opts.bold ? "/F2" : "/F1";
    const lineHeight = opts.lineHeight || (size*1.45);
    this._ensureSpace(lineHeight);
    const page = this.pages[this.pages.length-1];
    page.ops.push(`BT ${bold} ${size} Tf ${x.toFixed(2)} ${this.y.toFixed(2)} Td (${pdfEscText(str)}) Tj ET`);
    this.y -= lineHeight;
  }
  // Writes a long line as several lines (breaking at spaces) so it can't run off the page edge.
  wrapText(str, opts){
    opts = opts || {};
    const size = opts.size || 11;
    const maxChars = Math.floor((this.pageWidth - 2*this.marginX) / (size*0.5));
    const words = String(str).split(" ");
    let line = "", first = true;
    const flush = () => { this.text(this.marginX + (first ? 0 : 12), line, opts); first = false; };
    words.forEach(w=>{
      if(line && (line + " " + w).length > maxChars - (first ? 0 : 2)){ flush(); line = w; }
      else line = line ? line + " " + w : w;
    });
    if(line) flush();
  }
  centerText(str, opts){
    opts = opts || {};
    const size = opts.size || 11;
    const approxCharW = size * (opts.bold ? 0.62 : 0.52);
    const textWidth = String(str).length * approxCharW;
    const x = Math.max(this.marginX, (this.pageWidth - textWidth)/2);
    this.text(x, str, opts);
  }
  row(leftText, rightText, opts){
    opts = opts || {};
    const size = opts.size || 10.5;
    const bold = opts.bold ? "/F2" : "/F1";
    const lineHeight = size*1.55;
    this._ensureSpace(lineHeight);
    const page = this.pages[this.pages.length-1];
    const approxCharW = size * (opts.bold ? 0.62 : 0.56);
    const rightX = this.pageWidth - this.marginX - (String(rightText).length * approxCharW);
    page.ops.push(`BT ${bold} ${size} Tf ${this.marginX.toFixed(2)} ${this.y.toFixed(2)} Td (${pdfEscText(leftText)}) Tj ET`);
    page.ops.push(`BT ${bold} ${size} Tf ${rightX.toFixed(2)} ${this.y.toFixed(2)} Td (${pdfEscText(rightText)}) Tj ET`);
    this.y -= lineHeight;
  }
  hr(){
    this._ensureSpace(10);
    const page = this.pages[this.pages.length-1];
    const y = this.y - 2;
    page.ops.push(`0.75 w ${this.marginX} ${y.toFixed(2)} m ${this.pageWidth-this.marginX} ${y.toFixed(2)} l S`);
    this.y -= 10;
  }
  space(h){ this.y -= (h||8); }
  logoImage(widthPt, heightPt){
    if(!this.logoBytes) return;
    this._ensureSpace(heightPt+10);
    const page = this.pages[this.pages.length-1];
    const x = (this.pageWidth - widthPt)/2;
    const y = this.y - heightPt;
    page.ops.push(`q ${widthPt} 0 0 ${heightPt} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`);
    this.y -= (heightPt + 10);
    this._usesImage = true;
  }

  build(){
    const encoder = new TextEncoder();
    const chunks = [];
    let pos = 0;
    const offsets = {};
    function push(strOrBytes){
      const bytes = (strOrBytes instanceof Uint8Array) ? strOrBytes : encoder.encode(strOrBytes);
      chunks.push(bytes);
      pos += bytes.length;
    }
    function record(num){ offsets[num] = pos; }

    let objNum = 1;
    const catalogNum = objNum++;
    const pagesNum = objNum++;
    const fontNum = objNum++;
    const fontBoldNum = objNum++;
    let imageNum = null;
    if(this._usesImage && this.logoBytes) imageNum = objNum++;
    let gsNum = null;
    if(imageNum && this.watermarkOpacity > 0) gsNum = objNum++;
    const pageNums = this.pages.map(()=>objNum++);
    const contentNums = this.pages.map(()=>objNum++);

    push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    record(catalogNum);
    push(`${catalogNum} 0 obj\n<< /Type /Catalog /Pages ${pagesNum} 0 R >>\nendobj\n`);

    record(pagesNum);
    push(`${pagesNum} 0 obj\n<< /Type /Pages /Kids [${pageNums.map(n=>n+" 0 R").join(" ")}] /Count ${pageNums.length} >>\nendobj\n`);

    record(fontNum);
    push(`${fontNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`);
    record(fontBoldNum);
    push(`${fontBoldNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`);

    if(imageNum){
      record(imageNum);
      push(`${imageNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${this.logoW} /Height ${this.logoH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${this.logoBytes.length} >>\nstream\n`);
      push(this.logoBytes);
      push("\nendstream\nendobj\n");
    }
    if(gsNum){
      record(gsNum);
      push(`${gsNum} 0 obj\n<< /Type /ExtGState /ca ${this.watermarkOpacity} >>\nendobj\n`);
    }

    for(let i=0;i<this.pages.length;i++){
      const pageNum = pageNums[i];
      const contentNum = contentNums[i];
      const resources = `<< /Font << /F1 ${fontNum} 0 R /F2 ${fontBoldNum} 0 R >>${imageNum ? ` /XObject << /Im0 ${imageNum} 0 R >>` : ""}${gsNum ? ` /ExtGState << /GS1 ${gsNum} 0 R >>` : ""} >>`;
      record(pageNum);
      push(`${pageNum} 0 obj\n<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources ${resources} /Contents ${contentNum} 0 R >>\nendobj\n`);

      let ops = this.pages[i].ops;
      if(imageNum && gsNum){
        // Faint, centered watermark drawn first so all text paints on top of it.
        const wSize = Math.min(this.pageWidth, this.pageHeight) * 0.55;
        const wx = (this.pageWidth - wSize)/2;
        const wy = (this.pageHeight - wSize)/2;
        const watermarkOps = [`q /GS1 gs ${wSize.toFixed(2)} 0 0 ${wSize.toFixed(2)} ${wx.toFixed(2)} ${wy.toFixed(2)} cm /Im0 Do Q`];
        ops = watermarkOps.concat(ops);
      }
      const streamBody = ops.join("\n");
      const streamBytes = encoder.encode(streamBody);
      record(contentNum);
      push(`${contentNum} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
      push(streamBytes);
      push("\nendstream\nendobj\n");
    }

    const xrefStart = pos;
    const maxObjNum = objNum - 1;
    let xref = `xref\n0 ${maxObjNum+1}\n0000000000 65535 f \n`;
    for(let n=1; n<=maxObjNum; n++){
      const off = offsets[n];
      xref += (off===undefined ? "0000000000 00000 f \n" : String(off).padStart(10,"0")+" 00000 n \n");
    }
    push(xref);
    push(`trailer\n<< /Size ${maxObjNum+1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

    let total = 0;
    chunks.forEach(c=>total+=c.length);
    const out = new Uint8Array(total);
    let p = 0;
    chunks.forEach(c=>{ out.set(c,p); p+=c.length; });
    return out;
  }
}
