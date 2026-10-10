/* ---------- Minimal pure-JS ZIP writer (STORE method — no compression library needed) ----------
   Used to build real .docx files entirely offline. ZIP "store" mode is fully valid per spec;
   Word opens stored (uncompressed) docx files without issue. */

const CRC32_TABLE = (function(){
  const table = new Uint32Array(256);
  for(let n=0; n<256; n++){
    let c = n;
    for(let k=0; k<8; k++){
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes){
  let crc = 0xFFFFFFFF;
  for(let i=0; i<bytes.length; i++){
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function strToBytes(str){
  return new TextEncoder().encode(str);
}

function u16(n){ return [n & 0xFF, (n>>>8) & 0xFF]; }
function u32(n){ return [n & 0xFF, (n>>>8) & 0xFF, (n>>>16) & 0xFF, (n>>>24) & 0xFF]; }

/* files: array of {name, content} — content is either a string (UTF-8 encoded) or a Uint8Array (binary, e.g. an image) */
function buildZip(files){
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dosTime = 0, dosDate = 0x21; // fixed arbitrary valid date (Jan 1 1980+1) — fine for generated files

  files.forEach(f => {
    const nameBytes = encoder.encode(f.name);
    const dataBytes = (f.content instanceof Uint8Array) ? f.content : encoder.encode(f.content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const localHeader = [
      ...u32(0x04034b50),  // local file header signature
      ...u16(20),           // version needed
      ...u16(0),             // flags
      ...u16(0),             // compression method = 0 (store)
      ...u16(dosTime), ...u16(dosDate),
      ...u32(crc),
      ...u32(size),           // compressed size
      ...u32(size),           // uncompressed size
      ...u16(nameBytes.length),
      ...u16(0)               // extra field length
    ];
    localParts.push(new Uint8Array([...localHeader, ...nameBytes, ...dataBytes]));

    const centralHeader = [
      ...u32(0x02014b50),
      ...u16(20), ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(dosTime), ...u16(dosDate),
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset)
    ];
    centralParts.push({header: new Uint8Array([...centralHeader, ...nameBytes]), size: localParts[localParts.length-1].length});
    offset += localParts[localParts.length-1].length;
  });

  const centralStart = offset;
  let centralSize = 0;
  centralParts.forEach(c => centralSize += c.header.length);

  const endRecord = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(centralSize),
    ...u32(centralStart),
    ...u16(0)
  ]);

  const totalSize = offset + centralSize + endRecord.length;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  localParts.forEach(p => { out.set(p, pos); pos += p.length; });
  centralParts.forEach(c => { out.set(c.header, pos); pos += c.header.length; });
  out.set(endRecord, pos);

  return out;
}

function bytesToBase64(bytes){
  let binary = "";
  const chunk = 8192;
  for(let i=0; i<bytes.length; i+=chunk){
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
  }
  return btoa(binary);
}
