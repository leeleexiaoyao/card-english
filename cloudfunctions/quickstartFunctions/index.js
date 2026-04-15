const cloud = require("wx-server-sdk");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const WORD_COLLECTION = "words";
const WORD_QUERY_CHUNK = 100;
const WORD_MAX_LIMIT = 200;

function normalizeWordRecord(item = {}) {
  return {
    _id: item._id || "",
    word: String(item.word || "").trim(),
    phonetic: item.phonetic || "",
    translation: item.translation || "",
    definition: item.definition || "",
    detail: item.detail || "",
    pos: item.pos || "",
    exchange: item.exchange || "",
    audio: item.audio || "",
    collins: Number(item.collins || 0),
    oxford: Number(item.oxford || 0),
    tag: item.tag || "",
    bnc: Number(item.bnc || 0),
    frq: Number(item.frq || 0),
  };
}

async function fetchWordListChunk({ skip = 0, limit = WORD_QUERY_CHUNK }) {
  const safeLimit = Math.min(Math.max(Number(limit) || WORD_QUERY_CHUNK, 1), WORD_QUERY_CHUNK);
  const res = await db
    .collection(WORD_COLLECTION)
    .orderBy("word", "asc")
    .skip(Math.max(Number(skip) || 0, 0))
    .limit(safeLimit)
    .field({
      word: true,
      phonetic: true,
      translation: true,
      pos: true,
      audio: true,
      collins: true,
      oxford: true,
      bnc: true,
      frq: true,
    })
    .get();
  return (res.data || []).map(normalizeWordRecord);
}

const listWords = async (event) => {
  const page = Math.max(Number(event.page) || 0, 0);
  const limit = Math.min(Math.max(Number(event.limit) || WORD_MAX_LIMIT, 1), WORD_MAX_LIMIT);
  const skip = page * limit;
  const targetSize = limit + 1;
  const list = [];
  let fetched = 0;

  while (fetched < targetSize) {
    const currentLimit = Math.min(targetSize - fetched, WORD_QUERY_CHUNK);
    const currentList = await fetchWordListChunk({
      skip: skip + fetched,
      limit: currentLimit,
    });
    list.push(...currentList);
    fetched += currentList.length;
    if (currentList.length < currentLimit) {
      break;
    }
  }

  return {
    success: true,
    page,
    limit,
    hasMore: list.length > limit,
    list: list.slice(0, limit),
  };
};

async function queryWordByExactValue(word) {
  if (!word) {
    return null;
  }
  const res = await db
    .collection(WORD_COLLECTION)
    .where({
      word,
    })
    .limit(1)
    .get();
  const list = res.data || [];
  return list.length ? normalizeWordRecord(list[0]) : null;
}

const getWordDetail = async (event) => {
  const rawWord = String(event.word || "").trim();
  if (!rawWord) {
    return {
      success: false,
      errMsg: "word is required",
    };
  }

  const lowerWord = rawWord.toLowerCase();
  const candidates = [];
  [rawWord, lowerWord].forEach((item) => {
    if (item && !candidates.includes(item)) {
      candidates.push(item);
    }
  });

  for (let i = 0; i < candidates.length; i += 1) {
    const record = await queryWordByExactValue(candidates[i]);
    if (record) {
      return {
        success: true,
        item: record,
      };
    }
  }

  return {
    success: false,
    errMsg: `word not found: ${rawWord}`,
  };
};
// 获取openid
const getOpenId = async () => {
  // 获取基础信息
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
};

// 获取小程序二维码
const getMiniProgramCode = async () => {
  // 获取小程序二维码的buffer
  const resp = await cloud.openapi.wxacode.get({
    path: "pages/index/index",
  });
  const { buffer } = resp;
  // 将图片上传云存储空间
  const upload = await cloud.uploadFile({
    cloudPath: "code.png",
    fileContent: buffer,
  });
  return upload.fileID;
};

// 创建集合
const createCollection = async () => {
  try {
    // 创建集合
    await db.createCollection("sales");
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华东",
        city: "上海",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华东",
        city: "南京",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华南",
        city: "广州",
        sales: 22,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华南",
        city: "深圳",
        sales: 22,
      },
    });
    return {
      success: true,
    };
  } catch (e) {
    // 这里catch到的是该collection已经存在，从业务逻辑上来说是运行成功的，所以catch返回success给前端，避免工具在前端抛出异常
    return {
      success: true,
      data: "create collection success",
    };
  }
};

// 查询数据
const selectRecord = async () => {
  // 返回数据库查询结果
  return await db.collection("sales").get();
};

// 更新数据
const updateRecord = async (event) => {
  try {
    // 遍历修改数据库信息
    for (let i = 0; i < event.data.length; i++) {
      await db
        .collection("sales")
        .where({
          _id: event.data[i]._id,
        })
        .update({
          data: {
            sales: event.data[i].sales,
          },
        });
    }
    return {
      success: true,
      data: event.data,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 新增数据
const insertRecord = async (event) => {
  try {
    const insertRecord = event.data;
    // 插入数据
    await db.collection("sales").add({
      data: {
        region: insertRecord.region,
        city: insertRecord.city,
        sales: Number(insertRecord.sales),
      },
    });
    return {
      success: true,
      data: event.data,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 删除数据
const deleteRecord = async (event) => {
  try {
    await db
      .collection("sales")
      .where({
        _id: event.data._id,
      })
      .remove();
    return {
      success: true,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// const getOpenId = require('./getOpenId/index');
// const getMiniProgramCode = require('./getMiniProgramCode/index');
// const createCollection = require('./createCollection/index');
// const selectRecord = require('./selectRecord/index');
// const updateRecord = require('./updateRecord/index');
// const fetchGoodsList = require('./fetchGoodsList/index');
// const genMpQrcode = require('./genMpQrcode/index');
// 云函数入口函数
exports.main = async (event, context) => {
  switch (event.type) {
    case "getOpenId":
      return await getOpenId();
    case "listWords":
      return await listWords(event);
    case "getWordDetail":
      return await getWordDetail(event);
    case "getMiniProgramCode":
      return await getMiniProgramCode();
    case "createCollection":
      return await createCollection();
    case "selectRecord":
      return await selectRecord();
    case "updateRecord":
      return await updateRecord(event);
    case "insertRecord":
      return await insertRecord(event);
    case "deleteRecord":
      return await deleteRecord(event);
  }
};
