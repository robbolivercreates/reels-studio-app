/**
 * CapCut Desktop draft builder.
 *
 * CapCut Desktop projects are a folder of JSON files under
 * ~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<name>/. The format is
 * proprietary and undocumented — this module reverse-engineers it by mirroring
 * the schema observed in real CapCut projects (version 360000 / 163.0.0).
 *
 * A draft project consists of:
 *   - draft_info.json          → tracks, segments, materials (the timeline)
 *   - draft_meta_info.json     → catalog entry: name, paths, dates
 *   - draft_settings           → settings blob (small, mostly defaults)
 *   - draft_agency_config.json → agency config (small)
 *   - draft_biz_config.json    → empty
 *   - Resources/, subdraft/, matting/, qr_upload/, smart_crop/, common_attachment/, adjust_mask/
 *     (created empty; CapCut populates them on edit)
 *
 * Time units throughout: microseconds (1s = 1_000_000). The frontend uses
 * seconds, so we multiply on the way out.
 *
 * Media paths in the JSON are absolute paths to files on disk — CapCut
 * doesn't copy media into the project folder. We point them at the export
 * folder in ~/Movies/Reels Studio/<name>/.
 */

import type { ReelsState, ScriptBlock } from './types';

const SEC_TO_US = 1_000_000;
const VERSION = 360000;
const NEW_VERSION = '163.0.0';

const uuid = (): string => {
  // CapCut uses uppercase UUIDs everywhere — match that exactly.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().toUpperCase();
  }
  return Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0').toUpperCase(),
  ).join('-');
};

const nowMicros = (): number => Date.now() * 1000;

const dimensionsForAspect = (aspect: ReelsState['aspect']): { width: number; height: number } => {
  if (aspect === '16:9') return { width: 1920, height: 1080 };
  if (aspect === '1:1') return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
};

const usFromSec = (sec: number): number => Math.round(sec * SEC_TO_US);

// ─── Auxiliary materials (one per segment) ───────────────────────────────
// These templates are minimal — only the fields CapCut requires to load the
// project without errors. Each ID is regenerated per segment so refs stay unique.

const speedMaterial = (id: string) => ({
  curve_speed: null,
  id,
  mode: 0,
  speed: 1.0,
  type: 'speed',
});

const placeholderInfoMaterial = (id: string) => ({
  error_path: '',
  error_text: '',
  id,
  meta_type: 'none',
  res_path: '',
  res_text: '',
  type: 'placeholder_info',
});

const canvasMaterial = (id: string) => ({
  album_image: '',
  blur: 0.0,
  color: '',
  id,
  image: '',
  image_id: '',
  image_name: '',
  source_platform: 0,
  team_id: '',
  type: 'canvas_color',
});

const soundChannelMappingMaterial = (id: string) => ({
  audio_channel_mapping: 0,
  id,
  is_config_open: false,
  type: 'none',
});

const materialColorMaterial = (id: string) => ({
  gradient_angle: 90.0,
  gradient_colors: [],
  gradient_percents: [],
  height: 0.0,
  id,
  is_color_clip: false,
  is_gradient: false,
  solid_color: '',
  width: 0.0,
});

const loudnessMaterial = (id: string) => ({
  enable: false,
  file_id: '',
  id,
  loudness_param: null,
  target_loudness: 0.0,
  time_range: null,
});

const vocalSeparationMaterial = (id: string) => ({
  choice: 0,
  enter_from: '',
  final_algorithm: '',
  id,
  production_path: '',
  removed_sounds: [],
  time_range: null,
  type: 'vocal_separation',
});

const beatsMaterial = (id: string) => ({
  ai_beats: {
    beat_speed_infos: [],
    beats_path: '',
    beats_url: '',
    melody_path: '',
    melody_percents: [0.6],
    melody_url: '',
  },
  enable_ai_beats: false,
  gear: 404,
  gear_count: 0,
  id,
  mode: 404,
  type: 'beats',
  user_beats: [],
  user_delete_ai_beats: null,
});

// ─── Video material (one per video file referenced) ──────────────────────

interface VideoFileInfo {
  path: string;          // absolute path on disk
  filename: string;      // basename (e.g. "clip-avatar-01.mp4")
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

const videoMaterial = (id: string, info: VideoFileInfo) => ({
  aigc_history_id: '',
  aigc_item_id: '',
  aigc_type: 'none',
  audio_fade: null,
  beauty_body_auto_preset: null,
  beauty_body_preset_id: '',
  beauty_face_auto_preset: { name: '', preset_id: '', rate_map: '', scene: '' },
  beauty_face_auto_preset_infos: [],
  beauty_face_preset_infos: [],
  cartoon_path: '',
  category_id: '',
  // CapCut treats materials with empty category_name as remote/cloud assets
  // and silently drops them when the cloud cache misses. 'local' tells it
  // the asset is a local file that should be loaded from `path`.
  category_name: 'local',
  check_flag: 63485951,
  content_feature_info: null,
  corner_pin: null,
  crop: {
    lower_left_x: 0.0,
    lower_left_y: 1.0,
    lower_right_x: 1.0,
    lower_right_y: 1.0,
    upper_left_x: 0.0,
    upper_left_y: 0.0,
    upper_right_x: 1.0,
    upper_right_y: 0.0,
  },
  crop_ratio: 'free',
  crop_scale: 1.0,
  duration: usFromSec(info.durationSec),
  extra_type_option: 0,
  formula_id: '',
  freeze: null,
  has_audio: info.hasAudio,
  has_sound_separated: false,
  height: info.height,
  id,
  intensifies_audio_path: '',
  intensifies_path: '',
  is_ai_generate_content: false,
  is_copyright: false,
  is_text_edit_overdub: false,
  is_unified_beauty_mode: false,
  live_photo_cover_path: '',
  live_photo_timestamp: -1,
  local_id: '',
  local_material_from: '',
  local_material_id: '',
  material_id: '',
  material_name: info.filename,
  material_url: '',
  matting: {
    custom_matting_id: '',
    enable_matting_stroke: false,
    expansion: 0,
    feather: 0,
    flag: 0,
    has_use_quick_brush: false,
    has_use_quick_eraser: false,
    interactiveTime: [],
    path: '',
    reverse: false,
    strokes: [],
  },
  media_path: '',
  multi_camera_info: null,
  object_locked: null,
  origin_material_id: '',
  path: info.path,
  picture_from: 'none',
  picture_set_category_id: '',
  picture_set_category_name: '',
  request_id: '',
  reverse_intensifies_path: '',
  reverse_path: '',
  smart_match_info: null,
  smart_motion: null,
  source: 0,
  source_platform: 0,
  stable: {
    matrix_path: '',
    stable_level: 0,
    time_range: { start: 0, duration: usFromSec(info.durationSec) },
  },
  surface_trackings: [],
  team_id: '',
  type: 'video',
  unique_id: '',
  video_algorithm: {
    ai_background_configs: [],
    ai_expression_driven: null,
    ai_in_painting_config: [],
    ai_motion_driven: null,
    aigc_generate: null,
    aigc_generate_list: [],
    algorithms: [],
    complement_frame_config: null,
    deflicker: null,
    gameplay_configs: [],
    image_interpretation: null,
    motion_blur_config: null,
    mouth_shape_driver: null,
    noise_reduction: null,
    path: '',
    quality_enhance: null,
    skip_algorithm_index: [],
    smart_complement_frame: null,
    story_video_modify_video_config: { is_overwrite_last_video: false, task_id: '', tracker_task_id: '' },
    super_resolution: null,
    time_range: null,
  },
  video_mask_shadow: { alpha: 0.0, angle: 0.0, blur: 0.0, color: '', distance: 0.0, path: '', resource_id: '' },
  video_mask_stroke: { alpha: 0.0, color: '', distance: 0.0, horizontal_shift: 0.0, path: '', resource_id: '', size: 0.0, texture: 0.0, type: '', vertical_shift: 0.0 },
  width: info.width,
});

// ─── Audio material ──────────────────────────────────────────────────────

interface AudioFileInfo {
  path: string;
  filename: string; // for the `name` field
  durationSec: number;
}

const audioMaterial = (id: string, info: AudioFileInfo) => ({
  ai_music_generate_scene: 0,
  ai_music_type: 0,
  aigc_history_id: '',
  aigc_item_id: '',
  app_id: 0,
  category_id: '',
  // 'local' for the same reason as video — without this CapCut treats the
  // audio as a missing cloud asset and skips it from the timeline.
  category_name: 'local',
  check_flag: 1,
  copyright_limit_type: 'none',
  duration: usFromSec(info.durationSec),
  effect_id: '',
  formula_id: '',
  id,
  intensifies_path: '',
  is_ai_clone_tone: false,
  is_ai_clone_tone_post: false,
  is_text_edit_overdub: false,
  is_ugc: false,
  local_material_id: '',
  lyric_type: 0,
  moyin_emotion: '',
  music_id: '',
  music_source: '',
  name: info.filename.replace(/\.[^.]+$/, ''),
  path: info.path,
  pgc_id: '',
  pgc_name: '',
  query: '',
  request_id: '',
  resource_id: '',
  search_id: '',
  similiar_music_info: { original_song_id: '', original_song_name: '' },
  sound_separate_type: '',
  source_from: '',
  source_platform: 0,
  team_id: '',
  text_id: '',
  third_resource_id: '',
  tone_category_id: '',
  tone_category_name: '',
  tone_effect_id: '',
  tone_effect_name: '',
  tone_emotion_name_key: '',
  tone_emotion_role: '',
  tone_emotion_scale: 0.0,
  tone_emotion_selection: '',
  tone_emotion_style: '',
  tone_platform: '',
  tone_second_category_id: '',
  tone_second_category_name: '',
  tone_speaker: '',
  tone_type: '',
  tts_generate_scene: '',
  tts_task_id: '',
  type: 'video_original_sound',
  video_id: '',
  wave_points: [],
});

// ─── Segments ────────────────────────────────────────────────────────────
// `target_timerange` = where the segment lives on the timeline.
// `source_timerange` = which slice of the source media to use (we use full media).

interface SegmentInput {
  materialId: string;
  extraRefs: string[];   // 7 for video, 5 for audio
  sourceStartUs: number;
  sourceDurationUs: number;
  targetStartUs: number;
  targetDurationUs: number;
  trackRenderIndex: number; // 0 for main video, 1+ for stacked tracks
  volume: number;            // 0 = mute, 1 = full
}

const videoSegment = (s: SegmentInput) => ({
  caption_info: null,
  cartoon: false,
  clip: {
    alpha: 1.0,
    flip: { horizontal: false, vertical: false },
    rotation: 0.0,
    scale: { x: 1.0, y: 1.0 },
    transform: { x: 0.0, y: 0.0 },
  },
  color_correct_alg_result: '',
  common_keyframes: [],
  desc: '',
  digital_human_template_group_id: '',
  enable_adjust: true,
  enable_adjust_mask: true,
  enable_color_correct_adjust: false,
  enable_color_curves: true,
  enable_color_match_adjust: false,
  enable_color_wheels: true,
  enable_hsl: true,
  enable_hsl_curves: true,
  enable_lut: true,
  enable_mask_shadow: false,
  enable_mask_stroke: false,
  enable_smart_color_adjust: false,
  enable_video_mask: true,
  enable_color_adjust_pro: false,
  extra_material_refs: s.extraRefs,
  group_id: '',
  hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
  id: uuid(),
  intensifies_audio: false,
  is_loop: false,
  is_placeholder: false,
  is_tone_modify: false,
  keyframe_refs: [],
  last_nonzero_volume: 1.0,
  lyric_keyframes: null,
  material_id: s.materialId,
  raw_segment_id: '',
  render_index: 0,
  render_timerange: { duration: 0, start: 0 },
  responsive_layout: {
    enable: false,
    horizontal_pos_layout: 0,
    size_layout: 0,
    target_follow: '',
    vertical_pos_layout: 0,
  },
  reverse: false,
  source: 'segmentsourcenormal',
  source_timerange: { duration: s.sourceDurationUs, start: s.sourceStartUs },
  speed: 1.0,
  state: 0,
  target_timerange: { duration: s.targetDurationUs, start: s.targetStartUs },
  template_id: '',
  template_scene: 'default',
  track_attribute: 0,
  track_render_index: s.trackRenderIndex,
  uniform_scale: { on: true, value: 1.0 },
  visible: true,
  volume: s.volume,
});

const audioSegment = (s: SegmentInput) => ({
  caption_info: null,
  cartoon: false,
  clip: null,
  color_correct_alg_result: '',
  common_keyframes: [],
  desc: '',
  digital_human_template_group_id: '',
  enable_adjust: false,
  enable_adjust_mask: false,
  enable_color_correct_adjust: false,
  enable_color_curves: true,
  enable_color_match_adjust: false,
  enable_color_wheels: true,
  enable_hsl: false,
  enable_lut: false,
  enable_smart_color_adjust: false,
  enable_video_mask: true,
  extra_material_refs: s.extraRefs,
  group_id: '',
  hdr_settings: null,
  id: uuid(),
  intensifies_audio: false,
  is_loop: false,
  is_placeholder: false,
  is_tone_modify: false,
  keyframe_refs: [],
  last_nonzero_volume: 1.0,
  lyric_keyframes: null,
  material_id: s.materialId,
  raw_segment_id: '',
  render_index: 0,
  render_timerange: { duration: 0, start: 0 },
  responsive_layout: {
    enable: false,
    horizontal_pos_layout: 0,
    size_layout: 0,
    target_follow: '',
    vertical_pos_layout: 0,
  },
  reverse: false,
  source_timerange: { duration: s.sourceDurationUs, start: s.sourceStartUs },
  speed: 1.0,
  state: 0,
  target_timerange: { duration: s.targetDurationUs, start: s.targetStartUs },
  template_id: '',
  template_scene: 'default',
  track_attribute: 0,
  track_render_index: s.trackRenderIndex,
  uniform_scale: null,
  visible: true,
  volume: s.volume,
});

// ─── Builder result ──────────────────────────────────────────────────────

export interface CapcutDraftFiles {
  /** draft_info.json contents */
  draftInfo: string;
  /** draft_meta_info.json contents */
  draftMeta: string;
  /** draft_settings file contents (literal string) */
  draftSettings: string;
  /** draft_agency_config.json contents */
  draftAgencyConfig: string;
  /** draft_biz_config.json contents (empty) */
  draftBizConfig: string;
}

export interface CapcutBuildInput {
  state: ReelsState;
  /** Folder where the media files (audio + clips) live. Used as absolute path roots. */
  mediaDir: string;
  /** Folder where the draft will live (used inside draft_meta_info). */
  draftDir: string;
  /** Audio file info — required (we don't export without audio). */
  audio: AudioFileInfo;
  /** Avatar clips that have already been rendered, keyed by blockId. */
  clipsByBlockId: Record<string, VideoFileInfo>;
  /**
   * Rendered motion videos, keyed by blockId. Motions live on disk already
   * (rendered locally by Rust) — `path` points to the existing file. They go
   * on a second video track that overlays the avatar (or stand alone when the
   * block has no avatar clip).
   */
  motionsByBlockId?: Record<string, VideoFileInfo>;
}

// ─── Main builder ────────────────────────────────────────────────────────

export const buildCapcutDraft = (input: CapcutBuildInput): CapcutDraftFiles => {
  const { state, mediaDir: _mediaDir, draftDir, audio, clipsByBlockId, motionsByBlockId = {} } = input;
  const dims = dimensionsForAspect(state.aspect);

  // ─── Materials ────────────────────────────────────────────────────────
  // `videos` here means "video material" — there's one entry per source file.
  const videoMaterials: ReturnType<typeof videoMaterial>[] = [];
  const audioMaterials: ReturnType<typeof audioMaterial>[] = [];

  const speeds: ReturnType<typeof speedMaterial>[] = [];
  const placeholderInfos: ReturnType<typeof placeholderInfoMaterial>[] = [];
  const canvases: ReturnType<typeof canvasMaterial>[] = [];
  const soundChannelMappings: ReturnType<typeof soundChannelMappingMaterial>[] = [];
  const materialColors: ReturnType<typeof materialColorMaterial>[] = [];
  const loudnesses: ReturnType<typeof loudnessMaterial>[] = [];
  const vocalSeparations: ReturnType<typeof vocalSeparationMaterial>[] = [];
  const beatsList: ReturnType<typeof beatsMaterial>[] = [];

  // Two video tracks: main (avatar) and overlay (motion).
  const mainVideoSegments: ReturnType<typeof videoSegment>[] = [];
  const overlayVideoSegments: ReturnType<typeof videoSegment>[] = [];
  const audioSegments: ReturnType<typeof audioSegment>[] = [];

  // Helper: emit a video segment + create its 7 aux materials.
  const pushVideoSegment = (params: {
    info: VideoFileInfo;
    sourceDurUs: number;
    targetStartUs: number;
    targetDurUs: number;
    trackRenderIndex: number;
    volume: number;
    target: 'main' | 'overlay';
  }) => {
    const matId = uuid();
    videoMaterials.push(videoMaterial(matId, params.info));

    const speed = speedMaterial(uuid());
    const placeholderInfo = placeholderInfoMaterial(uuid());
    const canvas = canvasMaterial(uuid());
    const scm = soundChannelMappingMaterial(uuid());
    const matColor = materialColorMaterial(uuid());
    const loudness = loudnessMaterial(uuid());
    const vocalSep = vocalSeparationMaterial(uuid());
    speeds.push(speed);
    placeholderInfos.push(placeholderInfo);
    canvases.push(canvas);
    soundChannelMappings.push(scm);
    materialColors.push(matColor);
    loudnesses.push(loudness);
    vocalSeparations.push(vocalSep);

    const seg = videoSegment({
      materialId: matId,
      extraRefs: [speed.id, placeholderInfo.id, canvas.id, scm.id, matColor.id, loudness.id, vocalSep.id],
      sourceStartUs: 0,
      sourceDurationUs: params.sourceDurUs,
      targetStartUs: params.targetStartUs,
      targetDurationUs: params.targetDurUs,
      trackRenderIndex: params.trackRenderIndex,
      volume: params.volume,
    });
    if (params.target === 'main') mainVideoSegments.push(seg);
    else overlayVideoSegments.push(seg);
  };

  // ─── Build segments for each script block ─────────────────────────────
  let cursorUs = 0;
  for (const block of state.blocks as ScriptBlock[]) {
    const blockDurSec = Math.max(0.1, block.end - block.start);
    const durUs = usFromSec(blockDurSec);

    const avatarClip = block.kind === 'avatar' ? clipsByBlockId[block.id] : undefined;
    const motionClip = motionsByBlockId[block.id];

    if (avatarClip) {
      const sourceDurUs = Math.min(durUs, usFromSec(avatarClip.durationSec));
      pushVideoSegment({
        info: avatarClip,
        sourceDurUs,
        targetStartUs: cursorUs,
        targetDurUs: durUs,
        trackRenderIndex: 0,
        // Mute avatar audio — the Minimax narration track plays the audio.
        volume: 0,
        target: 'main',
      });
    }

    if (motionClip) {
      const motionDurUs = Math.min(durUs, usFromSec(motionClip.durationSec));
      pushVideoSegment({
        info: motionClip,
        sourceDurUs: motionDurUs,
        targetStartUs: cursorUs,
        // If there's no avatar, motion expands to the full block; otherwise it
        // sits on the overlay track for the duration of the motion only.
        targetDurUs: avatarClip ? motionDurUs : durUs,
        // Overlay track sits above the main track in CapCut.
        trackRenderIndex: avatarClip ? 1 : 0,
        // Motions are silent (rendered without audio). volume=1 is fine.
        volume: 1,
        target: avatarClip ? 'overlay' : 'main',
      });
    }

    // Bloco sem nada visual: avança o cursor (áudio segue tocando, vídeo fica preto).
    cursorUs += durUs;
  }

  const totalDurUs = cursorUs;

  // ─── One audio segment with the full Minimax narration ────────────────
  const audioMatId = uuid();
  audioMaterials.push(audioMaterial(audioMatId, audio));

  const aSpeed = speedMaterial(uuid());
  const aPlaceholder = placeholderInfoMaterial(uuid());
  const aBeats = beatsMaterial(uuid());
  const aScm = soundChannelMappingMaterial(uuid());
  const aVocal = vocalSeparationMaterial(uuid());
  speeds.push(aSpeed);
  placeholderInfos.push(aPlaceholder);
  beatsList.push(aBeats);
  soundChannelMappings.push(aScm);
  vocalSeparations.push(aVocal);

  const audioDurUs = usFromSec(audio.durationSec);
  audioSegments.push(
    audioSegment({
      materialId: audioMatId,
      extraRefs: [aSpeed.id, aPlaceholder.id, aBeats.id, aScm.id, aVocal.id],
      sourceStartUs: 0,
      sourceDurationUs: audioDurUs,
      targetStartUs: 0,
      targetDurationUs: audioDurUs,
      trackRenderIndex: 0,
      volume: 1.0,
    }),
  );

  // ─── Assemble tracks ──────────────────────────────────────────────────
  const tracks: unknown[] = [];
  if (mainVideoSegments.length > 0) {
    tracks.push({
      attribute: 0,
      flag: 0,
      id: uuid(),
      is_default_name: true,
      name: '',
      segments: mainVideoSegments,
      type: 'video',
    });
  }
  // Overlay video track for motions (only if any motion overlays exist).
  if (overlayVideoSegments.length > 0) {
    tracks.push({
      attribute: 0,
      flag: 0,
      id: uuid(),
      is_default_name: true,
      name: '',
      segments: overlayVideoSegments,
      type: 'video',
    });
  }
  // Audio track always present (we require audio for export)
  tracks.push({
    attribute: 0,
    flag: 0,
    id: uuid(),
    is_default_name: true,
    name: '',
    segments: audioSegments,
    type: 'audio',
  });

  // ─── Compose draft_info.json ──────────────────────────────────────────
  const projectId = uuid();
  const t = nowMicros();

  const draftInfo = {
    canvas_config: { background: null, height: dims.height, ratio: 'original', width: dims.width },
    color_space: -1,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: '',
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      multi_language_current: 'none',
      multi_language_list: [],
      multi_language_main: 'none',
      multi_language_mode: 'none',
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_keywords_config: null,
      subtitle_recognition_id: '',
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      use_float_render: false,
      video_mute: false,
      zoom_info_params: null,
    },
    cover: null,
    create_time: 0,
    duration: Math.max(totalDurUs, audioDurUs),
    extra_info: null,
    fps: 30.0,
    free_render_index_mode_on: false,
    function_assistant_info: {
      auto_adjust: false,
      auto_adjust_fixed: false,
      auto_adjust_fixed_value: 50.0,
      auto_adjust_segid_list: [],
      auto_caption: false,
      auto_caption_segid_list: [],
      auto_caption_template_id: '',
      caption_opt: false,
      caption_opt_segid_list: [],
      color_correction: false,
      color_correction_fixed: false,
      color_correction_fixed_value: 50.0,
      color_correction_segid_list: [],
      deflicker_segid_list: [],
      enhande_voice: false,
      enhande_voice_fixed: false,
      enhance_quality: false,
      enhance_quality_fixed: false,
      enhance_quality_segid_list: [],
      enhance_voice_segid_list: [],
      eye_correction: false,
      eye_correction_segid_list: [],
      fixed_rec_applied: false,
      fps: { den: 1, num: 0 },
      audio_noise_segid_list: [],
      normalize_loudness: false,
      normalize_loudness_audio_denoise_segid_list: [],
      normalize_loudness_fixed: false,
      normalize_loudness_segid_list: [],
      retouch: false,
      retouch_fixed: false,
      retouch_segid_list: [],
      smart_rec_applied: false,
      smart_segid_list: [],
      smooth_slow_motion: false,
      smooth_slow_motion_fixed: false,
      video_noise_segid_list: [],
    },
    group_container: null,
    id: projectId,
    is_drop_frame_timecode: false,
    keyframe_graph_list: [],
    keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    last_modified_platform: { app_id: 359289, app_source: 'cc', app_version: '8.3.0', device_id: '', hard_disk_id: '', mac_address: '', os: 'mac', os_version: '14.0' },
    lyrics_effects: [],
    materials: {
      ai_translates: [],
      audio_balances: [],
      audio_effects: [],
      audio_fades: [],
      audio_pannings: [],
      audio_pitch_shifts: [],
      audio_track_indexes: [],
      audios: audioMaterials,
      beats: beatsList,
      canvases,
      chromas: [],
      color_curves: [],
      common_mask: [],
      digital_human_model_dressing: [],
      digital_humans: [],
      drafts: [],
      effects: [],
      flowers: [],
      green_screens: [],
      handwrites: [],
      hsl: [],
      hsl_curves: [],
      images: [],
      log_color_wheels: [],
      loudnesses,
      manual_beautys: [],
      manual_deformations: [],
      material_animations: [],
      material_colors: materialColors,
      multi_language_refs: [],
      placeholder_infos: placeholderInfos,
      placeholders: [],
      plugin_effects: [],
      primary_color_wheels: [],
      realtime_denoises: [],
      shapes: [],
      smart_crops: [],
      smart_relights: [],
      sound_channel_mappings: soundChannelMappings,
      speeds,
      stickers: [],
      tail_leaders: [],
      text_templates: [],
      texts: [],
      time_marks: [],
      transitions: [],
      video_effects: [],
      video_radius: [],
      video_shadows: [],
      video_strokes: [],
      video_trackings: [],
      videos: videoMaterials,
      vocal_beautifys: [],
      vocal_separations: vocalSeparations,
    },
    mutable_config: null,
    name: '',
    new_version: NEW_VERSION,
    path: '',
    platform: { app_id: 359289, app_source: 'cc', app_version: '8.3.0', device_id: '', hard_disk_id: '', mac_address: '', os: 'mac', os_version: '14.0' },
    relationships: [],
    render_index_track_mode_on: true,
    retouch_cover: null,
    smart_ads_info: { draft_url: '', page_from: '', routine: '' },
    source: 'default',
    static_cover_image_path: '',
    time_marks: null,
    tracks,
    update_time: 0,
    uneven_animation_template_info: { composition: '', content: '', order: '', sub_template_info_list: [] },
    version: VERSION,
    draft_type: 'video',
  };

  // ─── draft_meta_info.json — the catalog entry ────────────────────────
  const projectName = state.projectName || 'Reel sem título';
  const draftMeta = {
    cloud_draft_cover: false,
    cloud_draft_sync: false,
    cloud_package_completed_time: '',
    draft_cloud_capcut_purchase_info: '',
    draft_cloud_last_action_download: false,
    draft_cloud_package_type: '',
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: 'draft_cover.jpg',
    draft_deeplink_url: '',
    draft_enterprise_info: { draft_enterprise_extra: '', draft_enterprise_id: '', draft_enterprise_name: '', enterprise_material: [] },
    draft_fold_path: draftDir,
    draft_id: projectId,
    draft_is_ae_produce: false,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_cloud_temp_draft: false,
    draft_is_from_deeplink: 'false',
    draft_is_invisible: false,
    draft_is_web_article_video: false,
    draft_materials: [
      { type: 0, value: [] },
      { type: 1, value: [] },
      { type: 2, value: [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
    ],
    draft_materials_copied_info: [],
    draft_name: projectName,
    draft_need_rename_folder: false,
    draft_new_version: '',
    draft_removable_storage_device: '',
    // The folder containing this draft (CapCut uses this to relocate references)
    draft_root_path: draftDir.replace(/\/[^/]+$/, ''),
    draft_segment_extra_info: [],
    draft_timeline_materials_size_: 0,
    draft_type: '',
    draft_web_article_video_enter_from: '',
    tm_draft_cloud_completed: '',
    tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0,
    tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1,
    tm_draft_cloud_user_id: -1,
    tm_draft_create: t,
    tm_draft_modified: t,
    tm_draft_removed: 0,
    tm_duration: Math.max(totalDurUs, audioDurUs),
  };

  // Other small support files
  const draftSettings = JSON.stringify({ beginning_part_setting: null, ending_part_setting: null });
  const draftAgencyConfig = JSON.stringify({});
  const draftBizConfig = '';

  return {
    draftInfo: JSON.stringify(draftInfo),
    draftMeta: JSON.stringify(draftMeta),
    draftSettings,
    draftAgencyConfig,
    draftBizConfig,
  };
};

export type { VideoFileInfo, AudioFileInfo };
