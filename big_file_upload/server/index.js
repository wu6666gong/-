const path = require("path"); // 路径
const fse = require("fs-extra"); // fs 扩展包

// 合并文件块
const UPLOAD_DIR = path.resolve(__dirname, ".", "target");
// console.log(UPLOAD_DIR);
const filename = "yb";
const filePath = path.resolve(UPLOAD_DIR, "..", `${filename}.jpeg`);
// console.log(filePath);

const pipeStream = (path, wirteStream) => {
  return new Promise(resolve => {
    const readStream = fse.createReadStream(path);
    readStream.on("end", () => {
      fse.unlinkSync(path);
      resolve();
    });
    readStream.pipe(wirteStream);
  });
};

const mergeFileChunk = async (filePath, filename, size) => {
  // console.log(filePath, filename, size);
  const chunDir = path.resolve(UPLOAD_DIR, filename);
  // console.log(chunDir);
  // 读是异步的
  const chunkPaths = await fse.readdir(chunDir);
  // console.log(chunkPaths);
  chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1]);
  await Promise.all(
    chunkPaths.map((chunkPath, index) =>
      pipeStream(
        path.resolve(chunDir, chunkPath),
        fse.createWriteStream(filePath, {
          start: index * size,
          end: (index + 1) * size
        })
      )
    )
  );
  console.log("文件合并成功");
  fse.rmdirSync(chunDir);
};
mergeFileChunk(filePath, filename, 0.1 * 1024 * 1024);
