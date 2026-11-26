/*!
 * baby-tile.js — 画像なし赤ちゃんの「動物タイル」と公式投稿判定（SSG / ブラウザ共通）
 *
 * - Node (scripts/ssg.js) からは require() で、ブラウザからは window.DBBTile で使う。
 * - thumbnail_url に X / Instagram の投稿URLが入っている場合は「写真」ではなく
 *   「公式投稿」とみなす（normalize で official_post_url へ移し、thumbnail_url は null に）。
 * - 一覧の並びは「生後 PHOTO_FIRST_DAYS 日以内は写真ありを先に」(sortPhotoFirst)。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DBBTile = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PHOTO_FIRST_DAYS = 120; // 生後約4か月

  var GROUP_LABEL = {
    cat:     'ネコのなかま',
    hoof:    'ひづめのなかま',
    primate: 'サルのなかま',
    bird:    '鳥のなかま',
    sea:     '水べのなかま',
    reptile: 'は虫類・両生類',
    other:   'けもののなかま'
  };

  var RED_PANDA = { img: '/assets/img/species/red-panda.svg' };

  // [アイコン, グループ, キーワード]。部分一致なので「先に判定したいもの」を上に。
  var SPECIES = [
    // 誤マッチ防止を先に（アシカ⊃シカ、サイチョウ⊃サイ、レッサーパンダ⊃パンダ、シマウマ⊃ウマ）
    ['🦭', 'sea',     ['アシカ', 'アザラシ', 'オットセイ', 'セイウチ', 'トド', 'sea lion', 'seal', 'walrus']],
    ['🐦', 'bird',    ['サイチョウ', 'hornbill']],
    [RED_PANDA, 'other', ['レッサーパンダ', 'lesser panda', 'red panda']],
    ['🦓', 'hoof',    ['シマウマ', 'zebra', 'オカピ', 'okapi']],
    ['🐐', 'hoof',    ['カモシカ']],
    ['🦝', 'other',   ['アライグマ', 'タヌキ', 'raccoon']],
    ['🦌', 'hoof',    ['ヤクシカ']],

    // 水べ
    ['🦦', 'sea',     ['カワウソ', 'ラッコ', 'otter']],
    ['🐬', 'sea',     ['イルカ', 'dolphin', 'シャチ', 'orca']],
    ['🐋', 'sea',     ['クジラ', 'ベルーガ', 'whale', 'beluga']],

    // 鳥
    ['🐧', 'bird',    ['ペンギン', 'penguin']],
    ['🦩', 'bird',    ['フラミンゴ', 'flamingo']],
    ['🦉', 'bird',    ['フクロウ', 'ミミズク', 'owl']],
    ['🦅', 'bird',    ['ワシ', 'タカ', 'eagle', 'hawk']],
    ['🦜', 'bird',    ['オウム', 'インコ', 'parrot', 'macaw']],
    ['🦚', 'bird',    ['クジャク', 'peacock']],
    ['🦢', 'bird',    ['ハクチョウ', '白鳥', 'swan']],
    ['🦆', 'bird',    ['カモ', 'duck']],
    ['🐦', 'bird',    ['ツル', 'タンチョウ', 'crane', 'エミュー', 'ダチョウ', 'ヒクイドリ', 'ペリカン', 'コウノトリ', 'トキ', 'bird']],

    // ネコ科
    ['🐯', 'cat',     ['トラ', 'タイガー', 'tiger']],
    ['🦁', 'cat',     ['ライオン', 'lion']],
    ['🐆', 'cat',     ['ヒョウ', 'レオパード', 'leopard', 'ジャガー', 'jaguar', 'チーター', 'cheetah']],
    ['🐱', 'cat',     ['ヤマネコ', 'マヌルネコ', 'サーバル', 'カラカル', 'オセロット', 'ネコ', 'cat']],

    // 霊長類
    ['🦍', 'primate', ['ゴリラ', 'gorilla']],
    ['🦧', 'primate', ['オランウータン', 'orangutan']],
    ['🐒', 'primate', ['サル', 'ザル', 'monkey', 'チンパンジー', 'ボノボ', 'テナガザル', 'マンドリル', 'ヒヒ', 'キツネザル', 'マーモセット', 'タマリン', 'lemur', 'chimpanzee']],

    // 有蹄類
    ['🦒', 'hoof',    ['キリン', 'giraffe']],
    ['🐘', 'hoof',    ['ゾウ', 'elephant']],
    ['🦏', 'hoof',    ['サイ', 'rhino']],
    ['🦛', 'hoof',    ['カバ', 'hippo']],
    ['🦬', 'hoof',    ['バイソン', 'bison', 'バッファロー']],
    ['🐫', 'hoof',    ['ラクダ', 'camel']],
    ['🦙', 'hoof',    ['アルパカ', 'ラマ', 'alpaca', 'llama']],
    ['🐐', 'hoof',    ['ヤギ', 'バーラル', 'アイベックス', 'カモシカ', 'goat']],
    ['🐏', 'hoof',    ['ヒツジ', 'sheep', 'ムフロン']],
    ['🐗', 'hoof',    ['イノシシ', 'ブタ', 'pig', 'boar', 'カワイノシシ']],
    ['🐮', 'hoof',    ['ウシ', 'cow', 'ヤク']],
    ['🐴', 'hoof',    ['ウマ', 'ポニー', 'ロバ', 'horse', 'pony']],
    ['🦌', 'hoof',    ['シカ', 'ジカ', '鹿', 'deer', 'プーズー', 'エランド', 'トナカイ', 'ヌー', 'ガゼル', 'インパラ', 'アンテロープ', 'eland']],
    ['🐾', 'hoof',    ['バク', 'tapir']],

    // その他のけもの
    ['🐼', 'other',   ['パンダ', 'panda']],
    ['🐻‍❄️', 'other', ['ホッキョクグマ', 'polar bear']],
    ['🐻', 'other',   ['クマ', 'グマ', 'bear']],
    ['🐨', 'other',   ['コアラ', 'koala']],
    ['🦘', 'other',   ['カンガルー', 'ワラビー', 'kangaroo', 'wallaby']],
    ['🐺', 'other',   ['オオカミ', 'wolf']],
    ['🦊', 'other',   ['キツネ', 'fox', 'フェネック']],
    ['🦥', 'other',   ['ナマケモノ', 'sloth']],
    ['🦔', 'other',   ['ハリネズミ', 'hedgehog']],
    ['🐰', 'other',   ['ウサギ', 'rabbit']],
    ['🐿️', 'other',   ['リス', 'プレーリードッグ', 'squirrel']],
    ['🦫', 'other',   ['ビーバー', 'beaver']],
    ['🦡', 'other',   ['アナグマ', 'ラーテル', 'badger']],

    // は虫類・両生類
    ['🐊', 'reptile', ['ワニ', 'crocodile', 'alligator']],
    ['🐢', 'reptile', ['カメ', 'turtle', 'tortoise']],
    ['🐍', 'reptile', ['ヘビ', 'snake', 'python']],
    ['🦎', 'reptile', ['トカゲ', 'イグアナ', 'lizard', 'gecko']],
    ['🐸', 'reptile', ['カエル', 'サンショウウオ', 'frog']]
  ];

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 種名 → { icon, group } */
  function speciesInfo(species) {
    var s = String(species || '').toLowerCase();
    if (s) {
      for (var i = 0; i < SPECIES.length; i++) {
        var keys = SPECIES[i][2];
        for (var k = 0; k < keys.length; k++) {
          if (s.indexOf(String(keys[k]).toLowerCase()) !== -1) {
            return { icon: SPECIES[i][0], group: SPECIES[i][1] };
          }
        }
      }
    }
    return { icon: '🐾', group: 'other' };
  }

  function iconHtml(icon) {
    if (icon && icon.img) return '<img class="ph-tile__img" src="' + esc(icon.img) + '" alt="" data-allow-big>';
    return esc(icon);
  }

  /** テキストしか入れられない場所向け（レッサーパンダは足あとで代用） */
  function emojiFor(species) {
    var ic = speciesInfo(species).icon;
    return (ic && ic.img) ? '🐾' : ic;
  }

  /* ---------- 公式投稿 URL ---------- */
  var RE_X  = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,30})\/status(?:es)?\/(\d{5,25})/i;
  var RE_IG = /^https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(p|reel|tv)\/([A-Za-z0-9_-]{5,40})/i;

  /** URL が公式投稿なら { kind, url(正規化済み), account } を返す。そうでなければ null */
  function officialPost(url) {
    var u = String(url || '').trim();
    var m = u.match(RE_X);
    if (m) return { kind: 'x', url: 'https://twitter.com/' + m[1] + '/status/' + m[2], account: m[1] };
    m = u.match(RE_IG);
    if (m) return { kind: 'instagram', url: 'https://www.instagram.com/' + m[1] + '/' + m[2] + '/', account: '' };
    return null;
  }

  /** thumbnail_url に投稿URLが入っていたら official_post_url へ移す（破壊的・同じ参照を返す） */
  function normalize(b) {
    if (!b || typeof b !== 'object') return b;
    var post = officialPost(b.thumbnail_url);
    if (post) {
      b.official_post_url = b.thumbnail_url;
      b.thumbnail_url = null;
    }
    return b;
  }

  function normalizeAll(list) {
    if (Array.isArray(list)) for (var i = 0; i < list.length; i++) normalize(list[i]);
    return list;
  }

  function hasPhoto(b) {
    return !!(b && b.thumbnail_url && !officialPost(b.thumbnail_url));
  }

  function hasOfficialPost(b) {
    return !!(b && (officialPost(b.official_post_url) || officialPost(b.thumbnail_url)));
  }

  /* ---------- 並び替え ---------- */
  /**
   * 生後 days 日以内の子だけ「写真あり → 写真なし」に並べ替える（各グループ内の順序は維持）。
   * それ以外の子は元の位置関係のまま後ろに続く。
   */
  function sortPhotoFirst(list, opts) {
    if (!Array.isArray(list)) return list;
    opts = opts || {};
    var days = opts.days != null ? opts.days : PHOTO_FIRST_DAYS;
    var now = opts.now ? new Date(opts.now) : new Date();
    var cutoff = now.getTime() - days * 86400000;
    var recentPhoto = [], recentNo = [], rest = [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var t = b && b.birthday ? Date.parse(b.birthday) : NaN;
      if (!isNaN(t) && t >= cutoff) (hasPhoto(b) ? recentPhoto : recentNo).push(b);
      else rest.push(b);
    }
    return recentPhoto.concat(recentNo, rest);
  }

  /* ---------- タイル HTML ---------- */
  var CAMERA_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

  /**
   * 動物タイル。親要素（position:relative）いっぱいに敷く。
   * variant: 'card'（一覧カード） | 'row'（小さい行サムネ） | 'hero'（詳細ページ）
   */
  function tileHtml(b, variant) {
    variant = variant || 'card';
    var info = speciesInfo(b && b.species);
    var ic = iconHtml(info.icon);
    var showLabel = variant !== 'row';
    var chip = (variant === 'card' && hasOfficialPost(b))
      ? '<span class="ph-tile__chip">' + CAMERA_SVG + '公式写真</span>' : '';
    return '<span class="ph-tile ph-tile--' + info.group + ' ph-tile--' + variant + '" aria-hidden="true">' +
      (variant === 'row' ? '' : '<span class="ph-tile__wm">' + ic + '</span>') +
      '<span class="ph-tile__icon">' + ic + '</span>' +
      (showLabel ? '<span class="ph-tile__label">' + esc(GROUP_LABEL[info.group]) + '</span>' : '') +
      chip +
      '</span>';
  }

  /* ---------- 公式投稿の埋め込み HTML（詳細ページ用） ---------- */
  function officialEmbedHtml(b, zooName) {
    var post = officialPost(b && (b.official_post_url || b.thumbnail_url));
    if (!post) return '';
    var src = zooName ? esc(zooName) + 'の公式投稿より' : '動物園の公式投稿より';
    var body;
    if (post.kind === 'x') {
      body = '<blockquote class="twitter-tweet" data-lang="ja" data-dnt="true">' +
        '<a href="' + esc(post.url) + '" target="_blank" rel="noopener">公式ポストを見る（X）</a></blockquote>' +
        '<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>';
    } else {
      body = '<blockquote class="instagram-media" data-instgrm-permalink="' + esc(post.url) + '" data-instgrm-version="14">' +
        '<a href="' + esc(post.url) + '" target="_blank" rel="noopener">公式投稿を見る（Instagram）</a></blockquote>' +
        '<script async src="https://www.instagram.com/embed.js"></script>';
    }
    return '<section class="official-post" id="official-post" aria-labelledby="official-post-h">' +
      '<div class="official-post__head"><h2 class="official-post__title" id="official-post-h">公式の写真・動画</h2>' +
      '<span class="official-post__src">' + src + '</span></div>' +
      '<div class="official-post__embed">' + body + '</div>' +
      '<p class="official-post__note">※ 各サービスの公式埋め込みで表示しています。写真・動画の権利は各動物園に帰属します。</p>' +
      '</section>';
  }

  /** 詳細ページのヒーロー（画像なし時）。公式投稿があれば「見る」ボタン付き */
  function heroHtml(b) {
    var btn = hasOfficialPost(b)
      ? '<a class="ph-hero__btn" href="#official-post">' + CAMERA_SVG + '公式の写真を見る ↓</a>' : '';
    return '<div class="ssg-detail__img ssg-detail__img--placeholder ph-hero">' +
      '<span class="ph-hero__a11y" role="img" aria-label="写真なし（' + esc((b && b.species) || '動物') + 'のイラスト）"></span>' +
      tileHtml(b, 'hero') + btn + '</div>';
  }

  return {
    PHOTO_FIRST_DAYS: PHOTO_FIRST_DAYS,
    speciesInfo: speciesInfo,
    emojiFor: emojiFor,
    officialPost: officialPost,
    normalize: normalize,
    normalizeAll: normalizeAll,
    hasPhoto: hasPhoto,
    hasOfficialPost: hasOfficialPost,
    sortPhotoFirst: sortPhotoFirst,
    tileHtml: tileHtml,
    heroHtml: heroHtml,
    officialEmbedHtml: officialEmbedHtml
  };
});
