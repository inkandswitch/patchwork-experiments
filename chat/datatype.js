export const ChatDatatype = {
        init(doc) {
                doc.title = "chitter chatter " + new Date().toLocaleString()
                doc.messages = []
                doc.docs = []
        },
        getTitle(doc) {
                return doc.title || "chitter chatter"
        },
        setTitle(doc, title) {
                doc.title = title
        },
}

