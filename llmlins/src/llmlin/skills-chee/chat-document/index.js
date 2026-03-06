export async function getChatDocument(repo, url) {
  const handle = await repo.find(url);
  await handle.whenReady();

  return {
    listMessages() {
      return handle.doc()?.messages ?? [];
    },

    sendMessage(data) {
      handle.change((doc) => {
        if (!doc.messages) doc.messages = [];
        doc.messages.push({
          id: data.id ?? String(Date.now()) + Math.random().toString(36).slice(2),
          name: data.name,
          text: data.text ?? "",
          timestamp: data.timestamp ?? Date.now(),
          ...(data.font !== undefined && { font: data.font }),
          ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
          ...(data.replyTo !== undefined && { replyTo: data.replyTo }),
          ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
          ...(data.imageName !== undefined && { imageName: data.imageName }),
          ...(data.voiceUrl !== undefined && { voiceUrl: data.voiceUrl }),
          ...(data.voiceDuration !== undefined && { voiceDuration: data.voiceDuration }),
          ...(data.gifSelfieUrl !== undefined && { gifSelfieUrl: data.gifSelfieUrl }),
          ...(data.reactions !== undefined && { reactions: data.reactions }),
          ...(data.isComputer !== undefined && { isComputer: data.isComputer }),
          ...(data.embeds !== undefined && { embeds: data.embeds }),
          ...(data.emoticons !== undefined && { emoticons: data.emoticons }),
        });
      });
    },

    getTitle() {
      return handle.doc()?.title ?? "chitter chatter";
    },

    setTitle(title) {
      handle.change((doc) => {
        doc.title = title;
      });
    },
  };
}
