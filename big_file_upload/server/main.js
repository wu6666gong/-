const http = require("http");
const path = require("path");
const multiparty = require("multiparty");
const server = http.createServer();
const fse = require("fs-extra");

const UPLOAD_DIR = path.resolve(__dirname, ".", "target");

server.on("request", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  // res.end("hello");
  if (req.url == "/") {
    const multipart = new multiparty.Form();
    multipart.parse(req, async (err, fields, files) => {
      if (err) {
        return;
      }
      // console.log(files);
      const [chunk] = files.chunk;
      const [filename] = fields.filename;
      console.log(filename);
      const dir_name = filename.split("-")[0];
      const chunkDir = path.resolve(UPLOAD_DIR, `${dir_name}`);
      if (!fse.existsSync(chunkDir)) {
        await fse.mkdirs(chunkDir);
      }
      await fse.move(chunk.path, `${chunkDir}/${filename}`);
    });
    console.log(multipart);
  } else if (req.url == "/merge") {
    res.end("OK");
  }
});
server.listen(3000, () => console.log("正在监听"));
