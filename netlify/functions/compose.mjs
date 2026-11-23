import sharp from 'sharp';

// 立ち絵と背景を置いている元のサイトURL（末尾のスラッシュなし）
const ASSET_SITE_URL = 'https://lucky-seahorse-c5ad97.netlify.app';

// ★背景を薄くする強さ（0.0 = そのまま / 0.4 = 40%薄く / 0.7 = かなり薄く）
const BG_FADE_ALPHA = 0.4;

// URLの文字化け・二重エンコードを防ぐ関数
function safeDecode(str) {
  if (!str) return '';
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

// サイトAから背景を取得（拡張子を省略しても .png / .jpg / .jpeg / .webp を自動で探す）
async function fetchBackground(bgName) {
  if (/\.(png|jpe?g|webp)$/i.test(bgName)) {
    const url = `${ASSET_SITE_URL}/bg/${encodeURIComponent(bgName)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`背景が見つかりません: ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }

  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const url = `${ASSET_SITE_URL}/bg/${encodeURIComponent(bgName + ext)}`;
    const res = await fetch(url);
    if (res.ok) {
      return Buffer.from(await res.arrayBuffer());
    }
  }
  throw new Error(`背景が見つかりません: ${bgName}`);
}

// サイトAから立ち絵を取得（拡張子が抜けていれば .png を補完）
async function fetchCharacter(char, costume, expr) {
  const fileName = /\.(png|jpe?g|webp)$/i.test(expr) ? expr : `${expr}.png`;
  const url = `${ASSET_SITE_URL}/${encodeURIComponent(char)}/${encodeURIComponent(costume)}/${encodeURIComponent(fileName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`立ち絵が見つかりません: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export default async (req, context) => {
  try {
    const params = context.params || {};
    const bg = safeDecode(params.bg);
    const char = safeDecode(params.char);
    const costume = safeDecode(params.costume);
    const expr = safeDecode(params.expr);

    if (!bg || !char || !costume || !expr) {
      return new Response('URL形式が違います (/mix/背景名/キャラ名/衣装名/表情.png)', {
        status: 400,
      });
    }

    // 1. サイトAから背景と立ち絵をダウンロード
    const [bgBufferRaw, charBufferRaw] = await Promise.all([
      fetchBackground(bg),
      fetchCharacter(char, costume, expr),
    ]);

    // 2. 背景が横1280pxより大きければリサイズ（1024×1024ならそのまま）
    const bgBuffer = await sharp(bgBufferRaw)
      .resize({
        width: 1280,
        withoutEnlargement: true,
      })
      .toBuffer();

    const bgMeta = await sharp(bgBuffer).metadata();
    const bgWidth = bgMeta.width || 1024;
    const bgHeight = bgMeta.height || 1024;

    // 3. 立ち絵を背景のサイズ(100%)にピッタリ合わせる（1024×1024同士ならズレゼロ）
    const charResizedBuffer = await sharp(charBufferRaw)
      .resize({
        width: bgWidth,
        height: bgHeight,
        fit: 'inside',
        withoutEnlargement: false,
      })
      .toBuffer();

    // 4. 重ねる画像のリストを作成
    const compositeLayers = [];

    // 背景を薄くする白い半透明フィルター
    if (BG_FADE_ALPHA > 0) {
      const bgOverlayBuffer = await sharp({
        create: {
          width: bgWidth,
          height: bgHeight,
          channels: 4,
          // ※白っぽく薄くする場合は 255, 255, 255。もし暗く落ち着かせたい時は 0, 0, 0 に変更
          background: { r: 255, g: 255, b: 255, alpha: BG_FADE_ALPHA },
        },
      })
        .png()
        .toBuffer();

      compositeLayers.push({
        input: bgOverlayBuffer,
        top: 0,
        left: 0,
      });
    }

    // 立ち絵を一番上に重ねる
    compositeLayers.push({
      input: charResizedBuffer,
      gravity: 'south',
    });

    // 5. 合成してWebPで返す
    const finalBuffer = await sharp(bgBuffer)
      .composite(compositeLayers)
      .webp({ quality: 85 })
      .toBuffer();

    return new Response(new Uint8Array(finalBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=86400',
        'Netlify-CDN-Cache-Control': 'public, max-age=604800, durable',
      },
    });
  } catch (error) {
    console.error(error);
    return new Response(`合成エラー: ${error.message}`, { status: 404 });
  }
};

export const config = {
  path: '/mix/:bg/:char/:costume/:expr',
};
