(function bootstrapAuthUiController(globalScope) {
  function createAuthUiController() {
    const modal = document.getElementById("clientAuthModal");
    const notice = document.getElementById("guestWorkspaceNotice");
    const noticeText = document.getElementById("guestWorkspaceNoticeText");
    const title = document.getElementById("licenseTitle");
    const hint = document.getElementById("licenseHint");
    const defaultTitle = title ? String(title.textContent || "").trim() : "";
    const defaultHint = hint ? String(hint.textContent || "").trim() : "";

    return {
      setModalOpen(open) {
        if (!modal) return;
        modal.classList.toggle("hidden", !open);
      },
      setGuestNoticeVisible(open, text = "") {
        if (notice) {
          notice.classList.toggle("hidden", !open);
        }
        if (noticeText && text) {
          const nextText = String(text || "").trim();
          if (noticeText.textContent !== nextText) {
            noticeText.textContent = nextText;
          }
        }
      },
      setModalCopy({titleText = "", hintText = ""} = {}) {
        if (title && titleText) {
          title.textContent = String(titleText || "").trim();
        }
        if (hint && hintText) {
          hint.textContent = String(hintText || "").trim();
        }
      },
      resetModalCopy() {
        if (title && defaultTitle) {
          title.textContent = defaultTitle;
        }
        if (hint && defaultHint) {
          hint.textContent = defaultHint;
        }
      }
    };
  }

  globalScope.createAuthUiController = createAuthUiController;
  if (!globalScope.cs2AlchemyAuthUiController && typeof document !== "undefined") {
    globalScope.cs2AlchemyAuthUiController = createAuthUiController();
  }
})(typeof window !== "undefined" ? window : globalThis);
