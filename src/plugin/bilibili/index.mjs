import Axios from 'axios';
import _ from 'lodash-es';
import NodeCache from 'node-cache';
import CQ from '../../utils/CQcode.mjs';
import emitter from '../../utils/emitter.mjs';
import logError from '../../utils/logError.mjs';
import parseJSON from '../../utils/parseJSON.mjs';
import { retryAsync } from '../../utils/retry.mjs';
import { getArticleInfo } from './article.mjs';
import { getDynamicInfo } from './dynamic.mjs';
import { getLiveRoomInfo } from './live.mjs';
import { getVideoInfo } from './video.mjs';
import './push.mjs';

const cache = new NodeCache({ stdTTL: 3 * 60 });
const recallWatch = new NodeCache({ stdTTL: 3 * 60 });

const getIdFromNormalLink = link => {
  if (typeof link !== 'string') return null;
  const searchVideo = /bilibili\.com\/video\/(?:av(\d+)|(bv[\da-z]+))/i.exec(link) || {};
  const searchDynamic = /t\.bilibili\.com\/(\d+)/i.exec(link) || /m\.bilibili\.com\/dynamic\/(\d+)/i.exec(link) || {};
  const searchArticle = /bilibili\.com\/read\/(?:cv|mobile\/)(\d+)/i.exec(link) || {};
  const searchLiveRoom = /live\.bilibili\.com\/(\d+)/i.exec(link) || {};
  return {
    aid: searchVideo[1],
    bvid: searchVideo[2],
    dyid: searchDynamic[1],
    arid: searchArticle[1],
    lrid: searchLiveRoom[1],
  };
};

const getIdFromShortLink = shortLink => {
  return retryAsync(() =>
    Axios.head(shortLink, {
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400,
    })
  )
    .then(ret => getIdFromNormalLink(ret.headers.location))
    .catch(e => {
      logError(`[error] bilibili head short link ${shortLink}`);
      logError(e);
      return {};
    });
};

const getIdFromMsg = async msg => {
  let result = getIdFromNormalLink(msg);
  if (Object.values(result).some(id => id)) return result;
  if ((result = /((b23|acg)\.tv|bili2233.cn)\/[0-9a-zA-Z]+/.exec(msg))) {
    return getIdFromShortLink(`https://${result[0]}`);
  }
  return {};
};

const getCacheKeys = (gid, ids) => ids.filter(id => id).map(id => `${gid}-${id}`);
const markSended = (gid, ...ids) => gid && getCacheKeys(gid, ids).forEach(key => cache.set(key, true));

const replyResult = async ({ context, message, at, reply, gid, ids }) => {
  const shouldRecallResult = () => global.config.bot.bilibili.respondRecall && !recallWatch.get(context.message_id);
  if (shouldRecallResult()) return;
  if (ids && ids.length) markSended(gid, ...ids);
  const res = await global.replyMsg(context, message, at, reply);
  const resultMsgId = _.get(res, 'data.message_id');
  if (!resultMsgId) return;
  if (shouldRecallResult()) {
    global.bot('delete_msg', { message_id: resultMsgId });
    return;
  }
  recallWatch.set(context.message_id, resultMsgId);
};

emitter.onBotCreated(() => {
  global.bot.on('notice.group_recall', ({ message_id }) => {
    if (!global.config.bot.bilibili.respondRecall || !recallWatch.has(message_id)) return;
    const resultMsgId = recallWatch.get(message_id);
    recallWatch.del(message_id);
    if (typeof resultMsgId === 'string' || typeof resultMsgId === 'number') {
      global.bot('delete_msg', { message_id: resultMsgId });
    }
  });
});

const bilibiliHandler = async context => {
  const setting = global.config.bot.bilibili;
  if (
    !(
      setting.despise ||
      setting.getVideoInfo ||
      setting.getDynamicInfo ||
      setting.getArticleInfo ||
      setting.getLiveRoomInfo
    )
  ) {
    return;
  }

  const { group_id: gid, message: msg } = context;
  const { url } =
    (() => {
      if (!msg.includes('哔哩哔哩')) return;
      if (msg.includes('com.tencent.miniapp_01')) {
        // 小程序
        if (setting.despise) {
          global.replyMsg(context, CQ.img('https://i.loli.net/2020/04/27/HegAkGhcr6lbPXv.png'));
        }
        const data = parseJSON(msg);
        return {
          url: _.get(data, 'meta.detail_1.qqdocurl'),
          title: _.get(data, 'meta.detail_1.desc'),
        };
      } else if (msg.includes('com.tencent.structmsg')) {
        // 结构化消息
        const data = parseJSON(msg);
        return {
          url: _.get(data, 'meta.news.jumpUrl'),
          title: _.get(data, 'meta.news.title'),
        };
      }
    })() || {};
  const param = await getIdFromMsg(url || msg);
  const { aid, bvid, dyid, arid, lrid } = param;

  if (gid && getCacheKeys(gid, Object.values(param)).some(key => cache.has(key))) return;

  // 撤回观察
  recallWatch.set(context.message_id, true);

  if (setting.getVideoInfo && (aid || bvid)) {
    const { text, ids, reply } = await getVideoInfo({ aid, bvid });
    if (text) {
      replyResult({
        context,
        message: text,
        at: false,
        reply: !!reply,
        gid,
        ids,
      });
    }
    return true;
  }

  if (setting.getDynamicInfo && dyid) {
    const reply = await getDynamicInfo(dyid);
    if (reply) {
      replyResult({
        context,
        message: reply.text,
        at: false,
        reply: !!reply.reply,
        gid,
        ids: [dyid],
      });
    }
    return true;
  }

  if (setting.getArticleInfo && arid) {
    const reply = await getArticleInfo(arid);
    if (reply) {
      replyResult({
        context,
        message: reply,
        gid,
        ids: [arid],
      });
    }
    return true;
  }

  if (setting.getLiveRoomInfo && lrid) {
    const reply = await getLiveRoomInfo(lrid);
    if (reply) {
      replyResult({
        context,
        message: reply,
        gid,
        ids: [lrid],
      });
    }
    return true;
  }

  recallWatch.del(context.message_id);
};

export default bilibiliHandler;
