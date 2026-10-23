import { MemoryForumStore } from '../src/db/memory'
import type { ForumStore } from '../src/db/store'
import type { Env } from '../src/env'
import { createPostImageRepository } from '../src/uploads/post-images'
import { runRepositoryContract } from './contract/repository-contract'
import { runPostPreviewContract } from './contract/post-preview-contract'
import { runTopicImageSummaryContract } from './contract/topic-image-contract'

runRepositoryContract('内存实现', {
  create: async () => new MemoryForumStore({ seed: false }),
})

runTopicImageSummaryContract('内存实现', {
  create: async () => new MemoryForumStore({ seed: false }),
  images: (store: ForumStore) => createPostImageRepository(store),
})

// env 为空对象即走内存仓储（createPostPreviewRepository 依据 env.DB 选择实现）。
runPostPreviewContract('内存实现', async () => ({
  store: new MemoryForumStore({ seed: false }),
  env: {} as Env,
}))
