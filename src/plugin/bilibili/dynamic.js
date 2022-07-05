import _ from 'lodash';
import NodeCache from 'node-cache';
import CQ from '../../CQcode';
import logError from '../../logError';
import humanNum from '../../utils/humanNum';
import { retryGet } from '../../utils/retry';
import { purgeLink, purgeLinkInText } from './utils';

const parseDynamicCard = ({
  desc: {
    type,
    dynamic_id_str,
    bvid,
    origin,
    user_profile: {
      info: { uname },
    },
  },
  card,
  extension,
}) => {
  const data = {
    dyid: dynamic_id_str,
    type,
    uname,
    card: { bvid, ...JSON.parse(card) },
  };
  if (origin) {
    data.origin = {
      desc: {
        ...origin,
        user_profile: data.card.origin_user,
      },
      card: data.card.origin,
    };
  }
  if (extension && extension.vote) {
    data.vote = JSON.parse(extension.vote);
  }
  return data;
};

const dynamicCard2msg = async (card, forPush = false) => {
  const parsedCard = parseDynamicCard(card);
  const {
    dyid,
    type,
    uname,
    card: { item },
  } = parsedCard;

  const lines = [`https://t.bilibili.com/${dyid}`, `UP：${CQ.escape(uname)}`, ''];

  // 推送时过滤抽奖结果
  if (type === 1 && forPush && item.content.includes('详情请点击互动抽奖查看')) return null;

  if (type in formatters) lines.push(...(await formatters[type](parsedCard, forPush)));
  else lines.push(`未知的动态类型 type=${type}`);

  return lines.join('\n').trim();
};

export const getDynamicInfo = async id => {
  try {
    const {
      data: {
        data: { card },
      },
    } = await retryGet(`https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/get_dynamic_detail?dynamic_id=${id}`, {
      timeout: 10000,
    });
    return dynamicCard2msg(card);
  } catch (e) {
    logError(`${global.getTime()} [error] bilibili get dynamic info ${id}`);
    logError(e);
    return null;
  }
};

const CACHE_MIN_TTL = 3600;
const firstSendingFlagCache = new NodeCache({ useClones: false });
const sendedDynamicIdCache = new NodeCache({ useClones: false });

export const getUserNewDynamicsInfo = async uid => {
  try {
    const {
      data: {
        data: { cards },
      },
    } = await retryGet(`https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/space_history?host_uid=${uid}`, {
      timeout: 10000,
    });
    const curDids = _.map(cards, 'desc.dynamic_id_str');
    // 拉到的有问题
    if (!curDids.length) {
      logError(`${global.getTime()} [error] bilibili get user dynamics info ${uid}: no dynamic`);
      logError(JSON.stringify(cards));
      return;
    }
    // 拉到的存起来
    const { pushCheckInterval } = global.config.bot.bilibili;
    const ttl = Math.max(CACHE_MIN_TTL, pushCheckInterval * 10);
    const newDids = new Set(curDids.filter(did => !sendedDynamicIdCache.get(did)));
    curDids.forEach(did => sendedDynamicIdCache.set(did, true, ttl));
    // 是首次拉取则不发送
    const isFirstSending = !firstSendingFlagCache.get(uid);
    firstSendingFlagCache.set(uid, true, ttl);
    if (isFirstSending) return;
    // 发
    return (
      await Promise.all(
        cards.filter(({ desc: { dynamic_id_str: did } }) => newDids.has(did)).map(card => dynamicCard2msg(card, true))
      )
    ).filter(Boolean);
  } catch (e) {
    logError(`${global.getTime()} [error] bilibili get user dynamics info ${uid}`);
    logError(e);
    return null;
  }
};

const ifArray = (cond, ...items) => (cond ? items : []);

const formatters = {
  // 转发
  1: async ({ origin, card }, forPush = false) => [
    CQ.escape(purgeLinkInText(card.item.content.trim())),
    '',
    (await dynamicCard2msg(origin, forPush).catch(e => {
      logError(`${global.getTime()} [error] bilibili parse original dynamic`, card);
      logError(e);
      return null;
    })) || `https://t.bilibili.com/${origin.dynamic_id_str}`,
  ],

  // 图文动态
  2: async ({
    card: {
      item: { description, pictures },
    },
  }) => [
    CQ.escape(purgeLinkInText(description.trim())),
    ...(global.config.bot.bilibili.dynamicImgPreDl
      ? await Promise.all(
          pictures.map(({ img_src }) =>
            CQ.imgPreDl(img_src, undefined, {
              timeout: global.config.bot.bilibili.imgPreDlTimeout * 1000,
            })
          )
        )
      : pictures.map(({ img_src }) => CQ.img(img_src))),
  ],

  // 文字动态
  4: ({ card: { item }, vote }) => {
    const lines = [CQ.escape(purgeLinkInText(item.content.trim()))];
    // 投票
    if (vote) {
      const { choice_cnt, desc, endtime, join_num, options } = vote;
      lines.push(
        '',
        `【投票】${desc}`,
        `截止日期：${new Date(endtime * 1000).toLocaleString()}`,
        `参与人数：${humanNum(join_num)}`,
        '',
        `投票选项（最多选择${choice_cnt}项）`,
        ...options.flatMap(({ desc, img_url }) => [`- ${desc}`, ...ifArray(img_url, CQ.img(img_url))])
      );
    }
    return lines;
  },

  // 视频
  8: ({ card: { aid, bvid, dynamic, pic, title, stat, owner } }) => [
    ...ifArray(dynamic, CQ.escape(purgeLinkInText(dynamic.trim())), ''),
    CQ.img(pic),
    `av${aid}`,
    CQ.escape(title.trim()),
    `UP：${CQ.escape(owner.name)}`,
    `${humanNum(stat.view)}播放 ${humanNum(stat.danmaku)}弹幕`,
    `https://www.bilibili.com/video/${bvid}`,
  ],

  // 文章
  64: ({ card: { title, id, summary, image_urls } }) => [
    ...ifArray(image_urls.length, CQ.img(image_urls[0])),
    CQ.escape(title.trim()),
    CQ.escape(summary.trim()),
    `https://www.bilibili.com/read/cv${id}`,
  ],

  // 音频
  256: ({ card: { title, id, cover, intro, author, playCnt, replyCnt, typeInfo } }) => [
    ...ifArray(intro, CQ.escape(purgeLinkInText(intro.trim())), ''),
    CQ.img(cover),
    `au${id}`,
    CQ.escape(title.trim()),
    `歌手：${CQ.escape(author)}`,
    `分类：${typeInfo}`,
    `${humanNum(playCnt)}播放 ${humanNum(replyCnt)}评论`,
    `https://www.bilibili.com/audio/au${id}`,
  ],

  // 类似外部分享的东西
  2048: ({
    card: {
      sketch: { title, cover_url, target_url },
    },
  }) => [CQ.img(cover_url), CQ.escape(title), CQ.escape(purgeLink(target_url))],

  // 直播
  4200: ({ card: { title, cover, roomid, short_id, area_v2_parent_name, area_v2_name, live_status, online } }) => [
    CQ.img(cover),
    CQ.escape(title),
    `房间号：${roomid}${short_id ? `  短号：${short_id}` : ''}`,
    `分区：${area_v2_parent_name}${area_v2_parent_name === area_v2_name ? '' : `-${area_v2_name}`}`,
    live_status ? `直播中  ${humanNum(online)}人气` : '未开播',
    `https://live.bilibili.com/${short_id || roomid}`,
  ],

  // 直播
  4308: ({
    card: {
      live_play_info: { cover, title, room_id, parent_area_name, area_name, live_status, online },
    },
  }) => [
    CQ.img(cover),
    CQ.escape(title),
    `房间号：${room_id}`,
    `分区：${parent_area_name}${parent_area_name === area_name ? '' : `-${area_name}`}`,
    live_status ? `直播中  ${humanNum(online)}人气` : '未开播',
    `https://live.bilibili.com/${room_id}`,
  ],
};
