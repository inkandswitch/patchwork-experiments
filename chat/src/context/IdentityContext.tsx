import {
	createContext,
	useContext,
	createSignal,
	onMount,
	onCleanup,
	type ParentComponent,
	type Accessor,
} from "solid-js"
import type {DocHandle, AutomergeUrl} from "@automerge/automerge-repo"
import type {ChatProfileDoc} from "../types"

interface IdentityContextValue {
	myName: Accessor<string>
	myFont: Accessor<string | null>
	myAvatarUrl: Accessor<AutomergeUrl | null>
	myColor: Accessor<string | null>
	chatProfileHandle: Accessor<DocHandle<ChatProfileDoc> | null>
	contactHandle: Accessor<DocHandle<any> | null>
	myEmoticons: Accessor<Record<string, AutomergeUrl>>
	setMyEmoticons: (v: Record<string, AutomergeUrl>) => void
	myFonts: Accessor<Record<string, AutomergeUrl>>
	setMyFonts: (v: Record<string, AutomergeUrl>) => void
}

const IdentityCtx = createContext<IdentityContextValue>()

export const IdentityProvider: ParentComponent = (props) => {
	const [myName, setMyName] = createSignal("Anonymous")
	const [myFont, setMyFont] = createSignal<string | null>(null)
	const [myAvatarUrl, setMyAvatarUrl] = createSignal<AutomergeUrl | null>(null)
	const [myColor, setMyColor] = createSignal<string | null>(null)
	const [chatProfileHandle, setChatProfileHandle] = createSignal<DocHandle<ChatProfileDoc> | null>(null)
	const [contactHandle, setContactHandle] = createSignal<DocHandle<any> | null>(null)
	const [myEmoticons, setMyEmoticons] = createSignal<Record<string, AutomergeUrl>>({})
	const [myFonts, setMyFonts] = createSignal<Record<string, AutomergeUrl>>({})

	onMount(async () => {
		try {
			const repo = (window as any).repo
			if (!repo) return
			const adh = (window as any).accountDocHandle
			if (!adh) return

			// Wait for account doc to be ready (may not be loaded from storage yet on reload)
			const readyAdh = await repo.find(adh.url)
			const ad = readyAdh.doc()
			if (!ad?.contactUrl) return

			const ch = await repo.find(ad.contactUrl)
			setContactHandle(ch)
			const cd = ch.doc()
			if (!cd) return
			if (cd.name) setMyName(cd.name)

			// Resolve chat profile doc
			let profileHandle: DocHandle<ChatProfileDoc>
			if (ad.chatProfileUrl) {
				profileHandle = await repo.find(ad.chatProfileUrl)
			} else if (cd.chatProfileUrl) {
				profileHandle = await repo.find(cd.chatProfileUrl)
				adh.change((d: any) => {
					d.chatProfileUrl = profileHandle.url
				})
			} else {
				const initialProfile: any = {readPositions: {}}
				if (cd.chat?.font) initialProfile.font = cd.chat.font
				profileHandle = await repo.create2(initialProfile)
				adh.change((d: any) => {
					d.chatProfileUrl = profileHandle.url
				})
				if (cd.chat) {
					ch.change((d: any) => {
						delete d.chat
					})
				}
			}
			setChatProfileHandle(profileHandle)

			const profile = profileHandle.doc()
			if (profile?.font) setMyFont(profile.font)
			if (profile?.emoticons) setMyEmoticons({...profile.emoticons})
			if (profile?.fonts) setMyFonts({...profile.fonts})

			if (cd.avatarUrl) {
				setMyAvatarUrl(cd.avatarUrl)
			}
			if (cd.color) setMyColor(cd.color)

			// Subscribe to contact doc changes (name, avatar, etc.)
			const onContactChange = () => {
				const updated = ch.doc() as any
				if (!updated) return
				if (updated.name) setMyName(updated.name)
				if (updated.avatarUrl && updated.avatarUrl !== myAvatarUrl()) {
					setMyAvatarUrl(updated.avatarUrl)
				}
				if (updated.color) setMyColor(updated.color)
			}
			ch.on("change", onContactChange)

			// Subscribe to profile doc changes (font, emoticons, fonts)
			const onProfileChange = () => {
				const updated = profileHandle.doc() as any
				if (!updated) return
				setMyFont(updated.font || null)
				if (updated.emoticons) setMyEmoticons({...updated.emoticons})
				if (updated.fonts) setMyFonts({...updated.fonts})
			}
			profileHandle.on("change", onProfileChange)

			onCleanup(() => {
				ch.off("change", onContactChange)
				profileHandle.off("change", onProfileChange)
			})
		} catch (e) {
			console.warn("[Chat] resolve account:", e)
		}
	})

	return (
		<IdentityCtx.Provider
			value={{
				myName,
				myFont,
				myAvatarUrl,
				myColor,
				chatProfileHandle,
				contactHandle,
				myEmoticons,
				setMyEmoticons,
				myFonts,
				setMyFonts,
			}}
		>
			{props.children}
		</IdentityCtx.Provider>
	)
}

export function useIdentity(): IdentityContextValue {
	const ctx = useContext(IdentityCtx)
	if (!ctx) throw new Error("useIdentity must be used within IdentityProvider")
	return ctx
}
