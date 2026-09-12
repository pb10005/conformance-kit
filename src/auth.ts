/**
 * @covers AC-001
 * @assumption AS-001 リンク有効期限は15分（未確定）
 */
export const LINK_TTL_MIN = 15;

export function requestLoginLink(_email: string) {
  return { status: 200 };
}
