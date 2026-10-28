// 스킬 설명(SKILL.md description)을 공방 노드에 보일 말로 — 앞머리를 떼고(detail), 카드 · 목록엔 괄호를 뺀 첫 문장(brief).
// 앞머리 — 「(스킬 이름)」 이 든 첫 문장(어느 단계인지 적은 것)과 맨 앞의 짧은 「이름 — 」(묶음 이름 · 제목 되풀이).
// React 없이 — src/skillDesc.test.ts 가 확인한다.
export function skillDetail(desc: string, id: string) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return desc.trim().replace(new RegExp(`^[^.]*\\(${esc}\\)\\.\\s*`), '').replace(/^(?:[^.—]{1,12} — )+/, '');
}

export function skillBrief(desc: string, id: string) {
  const s = skillDetail(desc, id).replace(/\s*\([^()]*\)/g, '');
  return (s.match(/^.*?\.(?=\s|$)/)?.[0] ?? s).replace(/\.$/, '');
}
