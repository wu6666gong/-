const path = require("path");
const fse = require("fs-extra");
const multiparty = require("multiparty");
const UPLOAD_DIR = path.resolve(__dirname, "..", "target");

const reslovePost = req => {
  return new Promise(reslove => {
    let chunk = "";
    req.on("data", data => {
      chunk += data; // 二进制流
    });
    req.on("end", () => {
      console.log("chunk", chunk);
      reslove(chunk);
    });
  });
};
const pipeStream = (path, writeStream) =>
  new Promise(reslove => {
    const readStream = fse.createReadStream(path);
    readStream.on("end", () => {
      reslove();
    });
    readStream.pipe(writeStream);
  });
const mergeFileChunk = async (filePath, fileHash, size) => {
  const chunkDir = path.resolve(UPLOAD_DIR, fileHash);
  const chunkPath = await fse.readdir(chunkDir);
  chunkPath.sort((a, b) => a.split("-")[1] - b.split("-")[1]);
  await Promise.all(
    chunkPath.map((chunkPath, index) => {
      console.log(chunkPath, "--------------");
      return pipeStream(
        path.resolve(chunkDir, chunkPath),
        fse.createWriteStream(filePath, {
          start: size * index,
          end: size * (index + 1)
        })
      );
    })
  );
};
const extractExt = filename => {
  return filename.slice(filename.lastIndexOf("."), filename.length);
};
module.exports = class {
  async handleVerifyUpload(req, res) {
    // res.end("verify");
    // 服务端有没有这个文件
    // 拿到POST 的 data， bodyParser
    const data = await reslovePost(req);
    const { fileHash, filename } = JSON.parse(data);
    const ext = extractExt(filename);
    console.log(ext);
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);
    console.log(filePath);
    if (fse.existsSync(filePath)) {
      res.end(
        JSON.stringify({
          shouldUpload: false,
          uploadList: []
        })
      );
    } else {
      res.end(
        JSON.stringify({
          shouldUpload: true,
          uploadList: []
        })
      );
    }
  }
  async handleFormData(req, res) {
    const multipartyFrom = new multiparty.Form();
    multipartyFrom.parse(req, async (err, fields, files) => {
      if (err) {
        console.error(err);
        res.status = 500;
        res.end("process file chunk failed");
      }
      const [chunk] = files.chunk;
      const [hash] = fields.hash;
      const [fileHash] = fields.fileHash;
      const [filename] = fields.filename;
      // console.log(chunk, hash, fileHash, filename, fields, files);
      const filePath = path.resolve(
        UPLOAD_DIR,
        `${fileHash}${extractExt(filename)}`
      );
      const chunkDir = path.resolve(UPLOAD_DIR, fileHash);
      if (fse.existsSync(filePath)) {
        res.end("file exist");
        return;
      }
      if (!fse.existsSync(chunkDir)) {
        // 如果目录地址有没有target
        await fse.mkdirs(chunkDir);
      }
      await fse.move(chunk.path, path.resolve(chunkDir, hash));
      res.end("received file chunk");
    });
  }
  async handleMerge(req, res) {
    const data = await reslovePost(req);
    const { fileHash, filename, size } = JSON.parse(data);
    const ext = extractExt(filename);
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);

    await mergeFileChunk(filePath, fileHash, size);
    res.end(
      JSON.stringify({
        code: 0,
        message: "file merged success"
      })
    );
  }
};
