import { useEffect, useState, type ChangeEvent } from 'react';
import { uploadAvatar } from './api.ts';
import { errorText } from './errors.ts';

const SIZE = 96;

// 프로필 이미지. 없으면(404) 아무것도 그리지 않는다.
// version은 내가 이미지를 바꿨을 때 주소를 바꿔 브라우저가 새로 받게 하는 값이다.
export function Avatar({ userId, version, size = 24 }: { userId: string; version: number; size?: number }) {
  const src = `/api/users/${userId}/avatar?v=${version}`;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) return null;
  return (
    <img
      src={src}
      alt=""
      data-testid={`avatar-${userId}`}
      width={size}
      height={size}
      style={{ borderRadius: '50%', verticalAlign: 'middle', objectFit: 'cover' }}
      onError={() => setFailed(true)}
    />
  );
}

// 고른 이미지를 브라우저에서 96×96 PNG로 줄인 뒤 올린다.
// 2017년에는 원본을 base64 문자열로 바꿔 MIME을 jpeg로 고정해 보냈다 (REVIEW C12).
export function AvatarUpload({ onUploaded }: { onUploaded: () => void }) {
  const [error, setError] = useState<string | null>(null);

  const change = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일을 다시 골라도 change가 일어나게 한다
    if (!file) return;
    let image: Blob;
    try {
      image = await resize(file);
    } catch {
      return setError(errorText('invalidImage'));
    }
    const failure = await uploadAvatar(image);
    setError(failure && errorText(failure));
    if (!failure) onUploaded();
  };

  return (
    <label style={{ marginLeft: 8 }}>
      프로필 사진{' '}
      <input type="file" aria-label="프로필 사진 변경" accept="image/png,image/jpeg,image/webp" onChange={change} />
      {error && <span role="alert"> {error}</span>}
    </label>
  );
}

// 가운데를 정사각형으로 잘라 SIZE×SIZE로 그린다.
async function resize(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  canvas
    .getContext('2d')!
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))), 'image/png'),
  );
}
