import sharp from 'sharp';

// 立ち絵と背景を置いている元のサイトURL（末尾のスラッシュなし）
const ASSET_SITE_URL = 'https://jazzy-sprinkles-3c72d5.netlify.app';

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

    // 2. 背景が横1280pxより大きければリサイズ（表示を速くし、エラーを防ぐ）
    const bgBuffer = await sharp(bgBufferRaw)
      .resize({
        width: 1280,
        withoutEnlargement: true,
      })
      .toBuffer();

    const bgMeta = await sharp(bgBuffer).metadata();
    const bgWidth = bgMeta.width || 1280;
    const bgHeight = bgMeta.height || 720;

    // 3. 立ち絵を背景の高さ95%（横幅は背景以内）に収まるよう自動調整
    const charResizedBuffer = await sharp(charBufferRaw)
      .resize({
        width: bgWidth,
        height: Math.floor(bgHeight * 0.95), // ★キャラを少し小さくしたい時は 0.85 などに変更
        fit: 'inside',
        withoutEnlargement: false,
      })
      .toBuffer();

    // 4. 背景に立ち絵を合成（下部・中央に配置）
    const finalBuffer = await sharp(bgBuffer)
      .composite([
        {
          input: charResizedBuffer,
          gravity: 'south',
        },
      ])
      .webp({ quality: 85 })
      .toBuffer();

    // 5. 合成した画像を返す（NetlifyのCDNに7日間記憶させ、2回目以降は再生成しない）
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