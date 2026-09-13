import { useState } from 'react';
export function CustomerAvatar({
  name,
  picture,
}: {
  name?: string | null;
  picture?: string | null;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="avatar">
      {picture && picture !== failed ? (
        <img
          src={picture}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(picture)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
        />
      ) : (
        (name ?? 'C')[0]
      )}
    </span>
  );
}
