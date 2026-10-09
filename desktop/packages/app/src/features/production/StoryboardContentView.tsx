import type { StoryboardPackageContent } from "@dramaip/contracts/production";

export function StoryboardContentView({
  content,
}: {
  content: StoryboardPackageContent;
}) {
  return (
    <div className="space-y-3 text-sm" aria-label="分镜包完整内容">
      <p>视觉方向：{content.visualDirection}</p>
      <p className="text-muted">
        这是制作方案，未生成媒体、未锁定资产，也不是费用报价；结构检查不代替叙事、权利和专业制作验收。
      </p>
      {content.productionNotes.map((note, index) => (
        <p key={index}>{note}</p>
      ))}
      <details>
        <summary>
          视觉、角色、场景与声音需求 · {content.assets.length} 项
        </summary>
        {content.assets.map((asset) => (
          <p key={asset.id} className="mt-2">
            {asset.title}（{asset.kind}）：{asset.description}
          </p>
        ))}
      </details>
      {content.scenes.map((scene, index) => (
        <section
          key={scene.sceneId}
          className="space-y-2 rounded border border-line p-3"
        >
          <h4 className="font-medium">
            场景 {index + 1} · {scene.shots.length} 镜头 ·{" "}
            {scene.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0)}{" "}
            秒
          </h4>
          {scene.shots.map((shot) => (
            <div key={shot.id} className="space-y-1 border-t border-line pt-2">
              <p className="font-medium">
                镜头 {shot.orderIndex + 1} · {shot.durationSeconds} 秒：
                {shot.visualAction}
              </p>
              <p>
                构图：{shot.composition} · 机位：{shot.camera} · 运动：
                {shot.movement}
              </p>
              <p>声音：{shot.sound}</p>
              <p className="whitespace-pre-wrap break-words">
                Prompt：{shot.prompt}
              </p>
              <p className="whitespace-pre-wrap break-words">
                负面 Prompt：{shot.negativePrompt}
              </p>
              <p>
                资产：
                {shot.assetIds
                  .map(
                    (id) =>
                      content.assets.find((asset) => asset.id === id)?.title ??
                      id,
                  )
                  .join("、")}
              </p>
              {content.subtitles
                .filter((item) => item.shotId === shot.id)
                .map((item) => (
                  <p key={item.id}>
                    字幕 {item.startSeconds}–{item.endSeconds} 秒：{item.text}
                  </p>
                ))}
              <details>
                <summary>核对稳定剧本块来源</summary>
                <p className="break-all">{shot.sourceBlockIds.join("、")}</p>
              </details>
            </div>
          ))}
        </section>
      ))}
      <h4 className="font-medium">模型提出的成本风险（不是报价）</h4>
      {content.costRisks.length ? (
        content.costRisks.map((risk, index) => (
          <p key={index}>
            {risk.severity} · {risk.reason}；缓解：{risk.mitigation}
          </p>
        ))
      ) : (
        <p>未提出风险，不等于无风险。</p>
      )}
      <h4 className="font-medium">外部依赖</h4>
      {content.externalDependencies.length ? (
        content.externalDependencies.map((item, index) => (
          <p key={index}>{item}</p>
        ))
      ) : (
        <p>模型未列出，仍需专业核验。</p>
      )}
    </div>
  );
}
