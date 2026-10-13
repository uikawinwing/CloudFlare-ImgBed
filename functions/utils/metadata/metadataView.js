/**
 * Metadata 管理端视图工具
 * 负责生成管理端可展示的 metadata，过滤敏感字段并按当前渠道配置补齐派生字段
 */
import { findConfiguredChannel, loadChannelConfig } from './channelConfig.js';
import { stripConfigDerivedMetadata, stripSensitiveMetadata } from './metadataSecurity.js';

/* ========== 主要函数 ========== */

// 创建复用的视图上下文，避免批量序列化时重复读取上传配置
export async function createMetadataViewContext(db, env) {
  return {
    db,
    env,
    uploadConfig: await loadChannelConfig(db, env, 'metadata view'),
  };
}
// 构建管理端可见 metadata，过滤敏感字段并补齐可展示链接
export async function buildFileMetadataForManagement(db, env, metadata = {}, viewContext = null) {
  const context = viewContext || await createMetadataViewContext(db, env);
  const view = stripConfigDerivedMetadata(stripSensitiveMetadata(metadata));

  // 管理端展示字段从当前渠道配置实时补齐，不依赖旧 metadata 中保存的派生值
  enrichHuggingFaceMetadata(context, metadata, view);

  return view;
}
// 将文件记录序列化为管理端列表接口使用的安全结构
export async function serializeFileRecordForManagement(db, env, file, viewContext = null) {
  return {
    name: file.id || file.name,
    metadata: await buildFileMetadataForManagement(db, env, file.metadata, viewContext),
  };
}
/* ========== 关键函数 ========== */

// 根据当前 HuggingFace 渠道配置补齐文件访问 URL
function enrichHuggingFaceMetadata(context, sourceMetadata, view) {
  if (sourceMetadata?.Channel !== 'HuggingFace') return;

  try {
    const channel = findConfiguredChannel(context.uploadConfig, 'huggingface', sourceMetadata);
    if (!channel) return;

    if (channel.repo && sourceMetadata.HfFilePath) {
      view.HfFileUrl = `https://huggingface.co/datasets/${channel.repo}/resolve/main/${sourceMetadata.HfFilePath}`;
    }
  } catch (error) {
    console.warn('Failed to enrich HuggingFace metadata:', error.message);
  }
}
