export type NotifyMessage =
  | {
      type: 'entry:new'
      userId: string
      feedId: string
      title: string
      body: string
      url: string
    }
  | {
      type: 'feed:failed24h'
      userId: string
      feedId: string
      title: string
      body: string
      url: string
    }

