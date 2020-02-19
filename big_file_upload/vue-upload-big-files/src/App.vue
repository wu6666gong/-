<template>
  <div id="app">
    <div>
      <input type="file"
             @change="handleFileChange" />
      <el-button @click="handleUpload">上传</el-button>
      <el-button @click="handleResume">恢复</el-button>
      <el-button @click="handlePause">暂停</el-button>
    </div>
    <div>
      <div>计算文件hash</div>
      <el-progress :percentage="hashPercentage"></el-progress>
      <div>总文件计算</div>
      <!-- 每个切片的进度  计算出来-->
      <!-- 1. 每块blob 上传 值 percentage -->
      <!-- 2. 计算属性 computed-->
      <el-progress :percentage="fakeUploadPercentage"></el-progress>
    </div>
    <!-- 多个切片上传 -->
    <el-table :data="data">
      <el-table-column prop="hash"
                       lable="切片hash"
                       align="center">
      </el-table-column>
      <el-table-column label="大小(kb)"
                       align="center"
                       width="120">
        <template v-slot="{row}">
          <div>
            {{row.size | transformBytes}}
          </div>
        </template>
      </el-table-column>
      <el-table-column lable="进度"
                       align="center">
        <template v-slot="{row}">
          <div>
            <el-progress :percentage="row.percentage"
                         color="#909399"></el-progress>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script>
const Status = {
  'wait': 'wait',
  'pause': 'pause',
  'uploading': 'uploading'
}
const SIZE = 1024 * 1024 * 0.01
export default {
  name: 'app',
  filters: {
    transformBytes (value) {
      return Number(value / 1024).toFixed(0)
    }
  },
  computed: {
    uploadPercentage () {
      if (!this.container.file || !this.data.length) return 0;
      const loaded = this.data.map(item => item.size * item.percentage).reduce((acc, cur) => acc + cur);
      return parseInt((loaded / this.container.file.size).toFixed(2));
    }
  },
  watch: {
    uploadPercentage (now) {
      if (now > this.fakeUploadPercentage) {
        this.fakeUploadPercentage = now
      }
    }
  },
  components: {
  },
  data: () => ({
    fakeUploadPercentage: 0,
    container: {
      file: null,
      hash: ''
    },
    status: Status.wait,
    hashPercentage: 0,
    data: [], // 上传的数据
    requestList: [] // xhr
  }),
  methods: {
    async handleResume () {
      this.status = Status.uploading;
      const { uploadList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      )
      await this.uploadChunks(uploadList)
    },
    handlePause () {
      this.status = Status.parse;
      this.resetData();
    },
    resetData () {
      this.requestList.forEach(xhr => xhr.abort());
      this.requestList = [];
      if (this.container.worker) {
        this.container.worker.onmessage = null;
      }
    },
    request ({
      url,
      method = 'POST',
      data,
      headers = {},
      requestList,
      onProgress = e => e
    }) {
      return new Promise((reslove) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url);
        xhr.upload.onprogress = onProgress;
        Object.keys(headers).forEach((key) => {
          xhr.setRequestHeader(key, headers[key]);
        })
        xhr.send(data);
        xhr.onload = (e) => {
          if (requestList) {
            //  xhr 完成
            const xhrIndex = requestList.findIndex(item => item === xhr);
            requestList.splice(xhrIndex, 1);
          }
          reslove({
            data: e.target.response
          })
        }
        if (requestList) {
          requestList.push(xhr);
        }
      })
    },
    async calculateHash (fileChunkList) {
      return new Promise(reslove => {
        // 封装花时间的任务
        // web works 单独开一个线程 独立于 worker
        // js 单线程 ui 主线程
        this.container.worker = new Worker('./hash.js');
        this.container.worker.postMessage({ fileChunkList });
        this.container.worker.onmessage = (e) => {
          // console.log(e.data);
          const { hash, percentage } = e.data
          this.hashPercentage = percentage;
          if (hash) {
            reslove(hash)
          }
        }
      })
    },
    async handleUpload () {
      if (!this.container.file) return;
      this.status = Status.uploading;
      const fileChunkList = this.createFileChunk(this.container.file);
      // console.log(fileChunkList);
      this.container.hash = await this.calculateHash(fileChunkList);
      // 上传验证
      const { shouldUpload, uploadList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      )
      if (!shouldUpload) {
        this.$message.success("秒传：上传成功");
        this.status = Status.wait
      }
      this.data = fileChunkList.map(({ file }, index) => ({
        fileHash: this.container.hash,
        index,
        hash: this.container.hash + '-' + index, // 每个块都哟自己的index在内的hash，可排序2
        chunk: file,
        size: file.size,
        percentage: uploadList.includes(index) ? 100 : 0, // 当前切片是否上传过
      }))
      await this.uploadChunks(uploadList) // 上传切片
    },
    async uploadChunks (uploadList = []) {
      const requestList = this.data.map(({ chunk, hash, index }) => {
        const formData = new FormData();
        formData.append("chunk", chunk);
        formData.append("hash", hash);
        formData.append("filename", this.container.file.name);
        formData.append("fileHash", this.container.hash)
        return { formData, index }
      }).map(async ({ formData, index }) =>
        this.request({
          url: 'http://localhost:3000/',
          data: formData,
          onProgress: this.createProgressHandle(this.data[index]),
          requestList: this.requestList
        })
      )
      await Promise.all(requestList);
      // 之前上传的切片数量+ 本次上传的切片数量 = 所有切片的数量的
      if ((uploadList.length + requestList.length) === this.data.length) {
        await this.mergeRequest();
      }
      console.log("可以发送合并请求了", uploadList);
      this.$message.success('上传成功');
    },
    async mergeRequest () {
      await this.request({
        url: 'http://localhost:3000/merge',
        headers: {
          "content-type": 'application/json'
        },
        data: JSON.stringify({
          size: SIZE,
          fileHash: this.container.hash,
          filename: this.container.file.name
        })
      })
    },
    createProgressHandle (item) {
      return e => {
        console.log(e);
        item.percentage = parseInt(String((e.loaded / e.total) * 100));
      }
    },
    async verifyUpload (filename, fileHash) {
      const { data } = await this.request({
        url: 'http://localhost:3000/verify',
        headers: {
          "content-type": 'application/json'
        },
        data: JSON.stringify({
          filename,
          fileHash
        })
      })
      return JSON.parse(data)
    },
    createFileChunk (file, size = SIZE) {
      let count = 0;
      const fileChunkList = [];
      while (count < file.size) {
        fileChunkList.push({
          file: file.slice(count, count + size)
        })
        count += size;
      }
      return fileChunkList;

    },
    handleFileChange (e) {
      //分割文件
      const [file] = e.target.files;
      this.container.file = file
      this.resetData();
      Object.assign(this.$data, this.$options.data());
      console.log(e.target.files);
    }
  },
}
</script>

<style>
#app {
  font-family: "Avenir", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>
