import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { createProjectProductionBrief, type ReviewPackageManifest } from '@sdns/core'
import type { DB, Repositories } from '@sdns/db'
import { projectAssetKindDir } from './asset-library'

export interface BuiltinDemoResult {
  projectId: string
  adaptationProjectId: string
  episodeId: string
  sceneId: string
  shotId: string
}

const DEMO_TITLE = '雾港来信 · 内置生产样片'
const CHARACTER_SLOTS = ['face_anchor', 'turnaround', 'expression', 'pose', 'costume', 'voice_reference'] as const
const SCENE_SLOTS = ['scene_layout', 'scene_variant', 'style_frame'] as const

export function createBuiltinDemo(repos: Repositories): BuiltinDemoResult {
  let assetRoot: string | undefined
  try {
    return repos.db.transaction((transaction) => {
      const db = transaction as DB
      const project = repos.project.createProject(db, {
        title: DEMO_TITLE,
        shortDramaType: '悬疑反转',
        targetAudience: '喜欢轻悬疑、女性成长与都市奇谈的观众',
        targetWordCount: 80_000,
        targetEpisodeCount: 12,
        coreHook: '失踪七年的姐姐，在旧码头给妹妹寄来一封日期写着“明天”的信。',
        emotionalCore: '妹妹从执念中学会相信自己的判断，也重新理解姐姐当年的选择。',
        coreSellingPoint: '一封来自未来的信，牵出被人为改写的港口事故记录。',
        synopsis: '完全虚构、无第三方 IP 的 DramaIP 内置样片。样片包含故事设定、角色与场景资产、十个镜头、静帧候选、参考锁、Animatic、声音轨、审片意见和交付示例。',
        styleGuide: '近未来滨海城市；克制冷色；关键线索使用暖琥珀色。悬疑信息必须由画面动作承载，不依赖大段解释。',
        visualStyleDirection: '竖屏电影感动态漫画，潮湿空气、雾、钠灯与蓝绿色反射，人物轮廓清楚。',
        productionBrief: createProjectProductionBrief({
          creationGoal: 'adapt_existing_ip',
          profile: {
            presentation: 'motion_comic',
            platform: 'short_video_vertical',
            region: 'mainland_china',
            aspectRatio: '9:16',
            episodeDuration: { minSeconds: 60, maxSeconds: 90 },
            pilotEpisodeCount: 1,
            budgetTier: 'starter',
          },
        }),
      })
      assetRoot = join(app.getPath('userData'), 'assets', 'projects', project.id)
      const visualDirectory = projectAssetKindDir(app.getPath('userData'), project.id, 'character_reference')
      const sceneDirectory = projectAssetKindDir(app.getPath('userData'), project.id, 'scene_reference')
      const audioDirectory = projectAssetKindDir(app.getPath('userData'), project.id, 'narration_audio')
      for (const directory of [visualDirectory, sceneDirectory, audioDirectory]) mkdirSync(directory, { recursive: true })

      const palette = [
        { name: 'lin-wu', label: '林雾角色锚点', colors: ['#0b2431', '#40a7b5', '#f0c7a8'] as const, kind: 'character_reference' as const },
        { name: 'chen-du', label: '陈渡角色锚点', colors: ['#18212e', '#69758b', '#e3bba0'] as const, kind: 'character_reference' as const },
        { name: 'archive', label: '旧港档案室场景', colors: ['#0d2831', '#b57a32', '#273e46'] as const, kind: 'scene_reference' as const },
        { name: 'pier', label: '雾港七码头场景', colors: ['#07151e', '#2c6f78', '#d69b46'] as const, kind: 'scene_reference' as const },
      ]
      const assets = palette.map((entry) => {
        const path = join(entry.kind === 'character_reference' ? visualDirectory : sceneDirectory, `${entry.name}.png`)
        const content = renderDemoPng(540, 960, entry.colors)
        writeFileSync(path, content)
        return repos.asset.createAsset(db, {
          projectId: project.id,
          kind: entry.kind,
          title: `${entry.label} · Mock`,
          description: 'DramaIP 自有内置样片素材；由确定性 Mock 生成器创建，可随样片再分发。',
          sourceEntityKind: 'project',
          sourceEntityId: project.id,
          localPath: path,
          relativePath: `demo/${entry.name}.png`,
          originalName: `${entry.name}.png`,
          sha256: createHash('sha256').update(content).digest('hex'),
          sizeBytes: content.byteLength,
          mimeType: 'image/png',
          width: 540,
          height: 960,
          tags: ['内置样片', 'Mock Provider', '可再分发'],
          metadata: { license: 'DramaIP built-in demo redistribution license', providerKind: 'mock', deterministic: true },
          status: 'available',
          packagePolicy: 'include_binary',
        })
      })
      const [linAsset, chenAsset, archiveAsset, pierAsset] = assets
      const silentWav = renderSilentWav(2, 16_000)
      const audioPath = join(audioDirectory, 'mist-port-temp-narration.wav')
      writeFileSync(audioPath, silentWav)
      const narrationAsset = repos.asset.createAsset(db, {
        projectId: project.id,
        kind: 'narration_audio',
        title: '样片临时旁白 · Mock',
        description: '确定性无声占位音轨，仅用于演示音轨血缘，不冒充真实 TTS。',
        sourceEntityKind: 'project',
        sourceEntityId: project.id,
        localPath: audioPath,
        relativePath: 'demo/mist-port-temp-narration.wav',
        originalName: 'mist-port-temp-narration.wav',
        sha256: createHash('sha256').update(silentWav).digest('hex'),
        sizeBytes: silentWav.byteLength,
        mimeType: 'audio/wav',
        durationSeconds: 2,
        tags: ['内置样片', 'Mock Provider', '临时声音'],
        metadata: { license: 'DramaIP built-in demo redistribution license', providerKind: 'mock', containsSpeech: false },
        status: 'available',
        packagePolicy: 'include_binary',
      })

      repos.chapter.createChapter(db, {
        projectId: project.id,
        title: '第一章：明日来信',
        orderIndex: 0,
        content: '林雾在闭馆后的港史档案室收到一封没有邮戳的信。信封上的笔迹属于失踪七年的姐姐，日期却是明天。她沿着信里提到的七码头编号，发现事故档案中被整齐裁掉的一页。',
        summary: '林雾收到来自“明天”的姐姐来信，并发现港口事故档案被改写。',
        hook: '失踪者寄来明日来信。',
        mainConflict: '林雾要在档案管理员陈渡阻止前找到被裁掉的一页。',
        cliffhanger: '监控中出现姐姐在七码头回头的画面。',
      })
      const lin = repos.character.createCharacter(db, {
        projectId: project.id,
        name: '林雾',
        role: '女主角',
        identity: '港史档案数字化修复员',
        personality: '克制、敏锐、面对亲人线索时会冲动',
        desire: '查清姐姐失踪真相',
        visualDescription: '二十七岁，短黑发，灰蓝风衣，左耳银色耳钉。',
        appearancePrompt: 'short black hair, slate blue trench coat, silver left earring, restrained expression',
      })
      const chen = repos.character.createCharacter(db, {
        projectId: project.id,
        name: '陈渡',
        role: '关键配角',
        identity: '港史馆夜班管理员',
        personality: '寡言、谨慎，知道事故档案的隐情',
        desire: '保护仍活着的事故证人',
        visualDescription: '三十二岁，深色工装，右手旧伤，常携黄铜钥匙圈。',
        appearancePrompt: 'dark work jacket, old scar on right hand, brass key ring, guarded expression',
      })
      const linProfile = repos.visualProfile.createVisualProfile(db, {
        projectId: project.id,
        characterId: lin.id,
        appearancePrompt: lin.appearancePrompt ?? '',
        faceDescription: '清晰下颌线，左耳银色耳钉',
        hairstyle: '齐耳短黑发',
        clothingStyle: '灰蓝风衣',
        colorPalette: '#0b2431,#40a7b5,#f0c7a8',
        voiceTone: '低声、克制、略带沙哑',
      })
      const chenProfile = repos.visualProfile.createVisualProfile(db, {
        projectId: project.id,
        characterId: chen.id,
        appearancePrompt: chen.appearancePrompt ?? '',
        faceDescription: '眉骨明显，右眉尾浅疤',
        hairstyle: '短发',
        clothingStyle: '深色港口工装',
        colorPalette: '#18212e,#69758b,#e3bba0',
        voiceTone: '平静、短句、压低音量',
      })
      const archiveSetting = repos.visualSetting.createVisualSetting(db, {
        projectId: project.id,
        title: '旧港档案室',
        type: 'location',
        visualPrompt: '窄长档案室，金属柜，钠灯穿过百叶窗，空气中有潮湿尘粒',
        referenceImageUrl: archiveAsset.localPath,
      })
      const pierSetting = repos.visualSetting.createVisualSetting(db, {
        projectId: project.id,
        title: '雾港七码头',
        type: 'location',
        visualPrompt: '深夜七码头，蓝绿色雾，远处航标灯，湿地面有暖色反射',
        referenceImageUrl: pierAsset.localPath,
      })
      const visualVersions = new Map<string, ReturnType<Repositories['visualAsset']['createVisualAssetVersion']>>()
      for (const [profile, asset, label] of [[linProfile, linAsset, '林雾'], [chenProfile, chenAsset, '陈渡']] as const) {
        for (const slot of CHARACTER_SLOTS) {
          const version = repos.visualAsset.createVisualAssetVersion(db, {
            projectId: project.id,
            ownerKind: 'visual_profile',
            ownerId: profile.id,
            assetId: asset.id,
            slot,
            label: `${label} · ${slot} · Mock`,
            notes: '内置样片确定性资产；可替换为用户自己的候选。',
          })
          repos.visualAsset.adoptVisualAssetVersion(db, version.id)
          visualVersions.set(`${profile.id}:${slot}`, version)
        }
      }
      for (const [setting, asset, label] of [[archiveSetting, archiveAsset, '档案室'], [pierSetting, pierAsset, '七码头']] as const) {
        for (const slot of SCENE_SLOTS) {
          const version = repos.visualAsset.createVisualAssetVersion(db, {
            projectId: project.id,
            ownerKind: 'visual_setting',
            ownerId: setting.id,
            assetId: asset.id,
            slot,
            label: `${label} · ${slot} · Mock`,
          })
          repos.visualAsset.adoptVisualAssetVersion(db, version.id)
          visualVersions.set(`${setting.id}:${slot}`, version)
        }
      }

      const adaptation = repos.adaptationProject.createAdaptationProject(db, {
        sourceProjectId: project.id,
        title: '雾港来信 · 第一季样片',
        targetEpisodeCount: 12,
        episodeDuration: '60–90 秒',
        adaptationStyle: '动态漫画悬疑',
        visualStyleDirection: project.visualStyleDirection,
        audience: project.targetAudience,
        seasonNumber: 1,
        sourceChapterRange: { from: 1, to: 1 },
        strategy: JSON.stringify({ demo: true, provider: 'mock', note: '只展示第一集十镜头生产链路。' }),
      })
      const episode = repos.episode.createEpisode(db, {
        adaptationProjectId: adaptation.id,
        episodeNumber: 1,
        title: '明日来信',
        summary: '林雾收到姐姐的明日来信，在旧港档案室找到被裁页的事故档案。',
        hook: '信封日期是明天。',
        mainConflict: '林雾必须在闭馆封锁前找到信中提到的事故档案。',
        reversal: '阻止她的陈渡其实在保护证人。',
        emotionalBeat: '林雾第一次承认自己仍相信姐姐活着。',
        cliffhanger: '姐姐出现在七码头的实时监控里。',
        keyVisuals: ['明日日期的信封', '被裁掉的事故档案', '雾中七码头'],
      })
      const script = repos.script.createScript(db, {
        adaptationProjectId: adaptation.id,
        episodeId: episode.id,
        episodeNumber: 1,
        title: '第一集：明日来信',
        content: '完整虚构样片剧本：林雾收到日期为明天的信；陈渡关闭档案室；二人在被裁掉的档案页背面发现七码头坐标；监控画面里出现失踪的姐姐。',
        hook: episode.hook,
        mainConflict: episode.mainConflict,
        emotionalBeat: episode.emotionalBeat,
        reversal: episode.reversal,
        cliffhanger: episode.cliffhanger,
        estimatedDuration: '75 秒',
      })
      const sceneDefinitions = [
        { title: '信封', location: '旧港档案室', setting: archiveSetting, visual: archiveAsset, summary: '闭馆后，林雾收到没有邮戳的信。', timeOfDay: '深夜' },
        { title: '被裁掉的一页', location: '档案柜走廊', setting: archiveSetting, visual: archiveAsset, summary: '陈渡阻止林雾，二人发现档案被人为裁页。', timeOfDay: '深夜' },
        { title: '监控里的姐姐', location: '雾港七码头', setting: pierSetting, visual: pierAsset, summary: '坐标指向七码头，实时监控中出现姐姐。', timeOfDay: '凌晨' },
      ]
      const shotDefinitions = [
        ['俯拍信封落在扫描台上，日期“明日”进入画面。', '特写', '静止', '警觉'],
        ['林雾抬头，空荡档案室的灯依次熄灭。', '中近景', '缓慢后拉', '不安'],
        ['她用紫外灯照出信纸上的七码头坐标。', '特写', '横移', '专注'],
        ['陈渡从金属柜尽头出现，举起黄铜钥匙圈。', '中景', '推近', '戒备'],
        ['两人在狭窄走廊对峙，林雾把信压在身后。', '双人中景', '手持微晃', '紧张'],
        ['陈渡抽出事故卷宗，整页纸边缘被切得过分整齐。', '近景', '跟手', '怀疑'],
        ['林雾把裁页缺口与信纸边缘重合，纹路完全吻合。', '微距', '静止', '震惊'],
        ['陈渡承认姐姐曾要求他保存监控备份。', '双人近景', '缓慢推近', '松动'],
        ['七码头监控画面被雾遮住，一个女人回头望向镜头。', '监控视角', '数字变焦', '诡异'],
        ['林雾认出左耳耳钉，屏幕时间跳到“明日 00:01”。', '特写', '猛推', '决绝'],
      ] as const
      const scenes = sceneDefinitions.map((definition, index) => repos.scene.createScene(db, {
        scriptId: script.id,
        episodeId: episode.id,
        sceneNumber: index + 1,
        title: definition.title,
        location: definition.location,
        timeOfDay: definition.timeOfDay,
        visualDescription: definition.summary,
        characters: index === 0 ? ['林雾'] : ['林雾', '陈渡'],
        summary: definition.summary,
        orderIndex: index,
      }))
      const shots = shotDefinitions.map(([visualDescription, cameraAngle, cameraMovement, emotion], index) => {
        const sceneIndex = index < 3 ? 0 : index < 7 ? 1 : 2
        const scene = scenes[sceneIndex]
        const shot = repos.shot.createShot(db, {
          sceneId: scene.id,
          episodeId: episode.id,
          shotNumber: index + 1,
          durationSeconds: [4, 5, 6, 5, 7, 6, 5, 8, 9, 6][index],
          visualDescription,
          characterIds: index === 0 || index === 2 ? [lin.id] : [lin.id, chen.id],
          dialogue: index === 7 ? '她说，别相信事故发生的日期。' : undefined,
          narration: index === 0 ? '姐姐失踪后的第两千五百五十六天，我收到了她的信。' : undefined,
          subtitleDraft: index === 7 ? '别相信事故发生的日期。' : index === 9 ? '明日 00:01' : undefined,
          cameraAngle,
          cameraMovement,
          emotion,
          action: visualDescription,
          videoPrompt: `${project.visualStyleDirection}；${visualDescription}`,
          negativePrompt: '文字水印，角色换脸，多余手指，横屏构图',
          imagePrompt: `${visualDescription}，竖屏 9:16，关键人物保持参考锚点`,
          consistencyNotes: '林雾左耳银色耳钉；陈渡右手旧伤与黄铜钥匙圈。',
          aiVideoDifficulty: index === 8 ? 'high' : index > 5 ? 'medium' : 'low',
        })
        const visualAsset = sceneDefinitions[sceneIndex].visual
        const candidate = repos.shotStill.createShotStillCandidate(db, {
          projectId: project.id,
          shotId: shot.id,
          assetId: visualAsset.id,
          kind: 'first_frame',
          label: `镜头 ${index + 1} · Mock 首帧 A`,
          notes: '内置样片确定性候选，可直接比较、Retake 或采用。',
          sourceFingerprint: shot.updatedAt,
        })
        repos.shotStill.adoptShotStillCandidate(db, candidate.id, shot.updatedAt)
        const setting = sceneDefinitions[sceneIndex].setting
        for (const [version, role] of [
          [visualVersions.get(`${linProfile.id}:face_anchor`), 'character'],
          [visualVersions.get(`${setting.id}:scene_layout`), 'scene'],
          [visualVersions.get(`${setting.id}:style_frame`), 'style'],
        ] as const) {
          if (version) repos.visualAsset.lockShotVisualAsset(db, { projectId: project.id, shotId: shot.id, visualAssetVersionId: version.id, role })
        }
        return { shot, candidate, asset: visualAsset }
      })

      const animatic = repos.animatic.createAnimaticDraft(db, {
        projectId: project.id,
        adaptationProjectId: adaptation.id,
        episodeId: episode.id,
        sourceFingerprint: shots.map(({ shot }) => `${shot.id}@${shot.updatedAt}`).join('|'),
        clips: shots.map(({ shot, candidate, asset }, index) => ({
          id: randomUUID(),
          shotId: shot.id,
          orderIndex: index,
          durationSeconds: shot.durationSeconds ?? 4,
          stillCandidateId: candidate.id,
          assetId: asset.id,
          transition: index === 0 || index === 9 ? 'fade' : 'cut',
          dialogue: shot.dialogue,
          narration: shot.narration,
          temporaryAudioAssetId: shot.narration ? narrationAsset.id : undefined,
        })),
        annotations: [{ id: randomUUID(), atSeconds: 28, shotId: shots[5].shot.id, category: 'information', note: '裁页线索需要至少停留两秒。', createdAt: new Date().toISOString() }],
      })
      repos.animatic.reviewAnimaticDraft(db, animatic.id, 'approved', '内置样片节奏已核验；用于演示，不代表发布母版。')
      const audioTrack = repos.audio.createAudioTrack(db, {
        projectId: project.id,
        adaptationProjectId: adaptation.id,
        episodeId: episode.id,
        kind: 'narration',
        label: '样片临时旁白 · Mock',
        sourceFingerprint: animatic.sourceFingerprint,
        clips: [{
          id: randomUUID(),
          shotId: shots[0].shot.id,
          text: shots[0].shot.narration,
          assetId: narrationAsset.id,
          startSeconds: 0,
          durationSeconds: 2,
          volume: 1,
          fadeInSeconds: 0,
          fadeOutSeconds: 0.2,
          loop: false,
          duckingIntent: false,
        }],
      })
      repos.audio.adoptAudioTrack(db, audioTrack.id)

      const packageId = randomUUID()
      const reviewManifest: ReviewPackageManifest = {
        format: 'dramaip-review',
        version: 1,
        packageId,
        projectId: project.id,
        adaptationProjectId: adaptation.id,
        episodeId: episode.id,
        title: `${DEMO_TITLE} · 审片示例`,
        createdAt: new Date().toISOString(),
        media: shots.map(({ shot }, index) => ({
          id: `demo-media-${index + 1}`,
          shotId: shot.id,
          orderIndex: index,
          label: `镜头 ${index + 1}`,
          relativePath: `media/${String(index + 1).padStart(3, '0')}.jpg`,
          mimeType: 'image/jpeg',
          durationSeconds: shot.durationSeconds,
        })),
      }
      repos.productionStudio.createReviewPackageRecord(db, {
        projectId: project.id,
        adaptationProjectId: adaptation.id,
        episodeId: episode.id,
        kind: 'offline',
        status: 'exported',
        title: reviewManifest.title,
        manifest: reviewManifest,
        outputPath: join(assetRoot, 'demo-review-example.dramaip-review.zip'),
      })
      const commentId = randomUUID()
      repos.productionStudio.upsertReviewComment(db, {
        id: commentId,
        packageId,
        shotId: shots[5].shot.id,
        timecodeSeconds: 28,
        authorAlias: '样片审片人',
        body: '裁页吻合的画面再停留两秒，并保持林雾左耳耳钉可见。',
        resolved: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      repos.productionStudio.insertReviewDecision(db, {
        id: randomUUID(),
        packageId,
        shotId: shots[5].shot.id,
        decision: 'request_changes',
        authorAlias: '样片审片人',
        note: '局部 Retake 后复审。',
        createdAt: new Date().toISOString(),
      })
      const creative = repos.platformDelivery.createDeliveryCreativeVariant(db, {
        projectId: project.id,
        adaptationProjectId: adaptation.id,
        label: '样片交付文案 A',
        title: '失踪七年的姐姐，寄来一封来自明天的信',
        description: '完全虚构的 DramaIP 内置生产样片。',
        tags: ['悬疑', '动态漫画', '内置样片'],
        coverAssetId: pierAsset.id,
        source: 'manual',
        status: 'adopted',
      })
      const deliveryDirectory = join(assetRoot, 'demo-delivery-example')
      mkdirSync(deliveryDirectory, { recursive: true })
      const deliveryManifestPath = join(deliveryDirectory, 'manifest.json')
      writeFileSync(deliveryManifestPath, `${JSON.stringify({ format: 'dramaip-demo-delivery', version: 1, projectId: project.id, episodeId: episode.id, note: '样片交付示例；可在导演工作台重新生成正式包。' }, null, 2)}\n`)
      const delivery = repos.platformDelivery.createPlatformDeliveryExport(db, {
        projectId: project.id,
        adaptationProjectId: adaptation.id,
        episodeId: episode.id,
        profileId: 'sdns-vertical-master-2026-07',
        profileVersion: 'sdns-vertical-master/2026-07',
        creativeVariantId: creative.id,
        complianceTaskId: 'demo-compliance-evidence',
        deliveryVersion: 1,
        outputDirectory: deliveryDirectory,
        manifestPath: deliveryManifestPath,
        sourceFingerprint: animatic.sourceFingerprint,
      })
      repos.productionStudio.createProductionImpact(db, {
        projectId: project.id,
        source: { kind: 'still', id: shots[5].candidate.id, version: shots[5].candidate.updatedAt, label: shots[5].candidate.label },
        target: { kind: 'review', id: packageId, label: reviewManifest.title },
        reason: '样片审片人要求裁页线索停留更久；可通过局部 Retake 或时长调整后解决。',
        severity: 'warning',
      })
      repos.productionStudio.createProductionImpact(db, {
        projectId: project.id,
        source: { kind: 'review', id: packageId, label: reviewManifest.title },
        target: { kind: 'delivery', id: delivery.id, label: '样片交付示例 v1' },
        reason: '这是教学用影响，已带理由豁免，以便样片仍能演示交付导出。',
        severity: 'blocker',
        status: 'waived',
        resolutionNote: '内置样片保留一个已豁免案例，用于展示审计记录；不用于真实发布。',
      })
      ensureMockImageProvider(repos, db)
      repos.productionStudio.recordProductAnalyticsEvent(db, {
        eventName: 'demo_opened',
        appVersion: app.getVersion(),
        operatingSystem: process.platform,
      })
      return {
        projectId: project.id,
        adaptationProjectId: adaptation.id,
        episodeId: episode.id,
        sceneId: scenes[0].id,
        shotId: shots[0].shot.id,
      }
    })
  } catch (error) {
    if (assetRoot) rmSync(assetRoot, { recursive: true, force: true })
    throw error
  }
}

function ensureMockImageProvider(repos: Repositories, db: DB): void {
  const existing = repos.imageProviderConfig.listImageProviderConfigs(db).find((config) => config.kind === 'mock')
  if (existing) {
    if (!existing.featureEnabled) repos.imageProviderConfig.updateImageProviderConfig(db, existing.id, { featureEnabled: true })
    return
  }
  repos.imageProviderConfig.createImageProviderConfig(db, {
    name: 'DramaIP Mock 图片（离线确定性）',
    kind: 'mock',
    model: 'mock-image-v1',
    featureEnabled: true,
    isDefault: !repos.imageProviderConfig.getDefaultImageProviderConfig(db),
  })
}

function renderDemoPng(width: number, height: number, colors: readonly [string, string, string]): Buffer {
  const rgb = colors.map(hexRgb)
  const rowSize = width * 4 + 1
  const raw = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * rowSize
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const color = x < width * 0.38 ? rgb[0] : x < width * 0.78 ? rgb[1] : rgb[2]
      const shade = 0.72 + 0.28 * (1 - y / height)
      const offset = row + 1 + x * 4
      raw[offset] = Math.round(color[0] * shade)
      raw[offset + 1] = Math.round(color[1] * shade)
      raw[offset + 2] = Math.round(color[2] * shade)
      raw[offset + 3] = 255
    }
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii')
  const output = Buffer.alloc(data.length + 12)
  output.writeUInt32BE(data.length, 0)
  typeBuffer.copy(output, 4)
  data.copy(output, 8)
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8)
  return output
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function hexRgb(value: string): [number, number, number] {
  return [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16)]
}

function renderSilentWav(durationSeconds: number, sampleRate: number): Buffer {
  const dataSize = durationSeconds * sampleRate * 2
  const output = Buffer.alloc(44 + dataSize)
  output.write('RIFF', 0)
  output.writeUInt32LE(36 + dataSize, 4)
  output.write('WAVEfmt ', 8)
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(1, 22)
  output.writeUInt32LE(sampleRate, 24)
  output.writeUInt32LE(sampleRate * 2, 28)
  output.writeUInt16LE(2, 32)
  output.writeUInt16LE(16, 34)
  output.write('data', 36)
  output.writeUInt32LE(dataSize, 40)
  return output
}
