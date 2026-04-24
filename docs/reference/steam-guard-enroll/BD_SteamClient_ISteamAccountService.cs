using BD.SteamClient.Models.Profile;

namespace BD.SteamClient.Services;

public interface ISteamAccountService
{
    /// <summary>
    /// 获取 Steam 登录所需的 RSAkey 来加密 password
    /// </summary>
    Task<(string encryptedPassword64, string timestamp)> GetRSAkeyAsync(
        string username,
        string password);

    /// <summary>
    /// 新版登录时获取 RSAkey
    /// </summary>
    Task<(string encryptedPassword64, ulong timestamp)> GetRSAkeyV2Async(
        string username,
        string password);

    /// <summary>
    /// 执行请求 Steam 登录，返回登录状态
    /// </summary>
    Task DoLoginAsync(SteamLoginState loginState, bool isTransfer = false, bool isDownloadCaptchaImage = false);

    /// <summary>
    /// 执行新版请求 Steam 登录，返回登录状态
    /// </summary>
    Task DoLoginV2Async(SteamLoginState loginState);

    /// <summary>
    /// QRCode 登录
    /// </summary>
    Task DoLoginWithQRCodeAsync(
            SteamLoginState loginState,
            Func<CAuthentication_BeginAuthSessionViaQR_Response, Task<bool>> processSessionFunc,
            string? deviceFriendlyName = null,
            uint gamingDeviceType = default,
            int osType = 20,
            CancellationToken cancellationToken = default
        );

    /// <summary>
    /// 执行 Steam 第三方快速登录接口请求并返回登录后 Cookie
    /// </summary>
    [Obsolete("现已使用 Steam 登录状态在浏览器中登录")]
    Task<CookieCollection?> OpenIdLoginAsync(
        string openidparams,
        string nonce,
        CookieCollection cookie);

    Task<(bool IsSuccess, string? Message, HistoryParseResponse? History)> GetAccountHistoryDetail(SteamLoginState loginState);

    Task<bool> GetWalletBalance(SteamLoginState loginState);

    Task<(SteamResult Result, PurchaseResultDetail? Detail)?> RedeemWalletCode(
        SteamLoginState loginState,
        string walletCode,
        bool isRetry = false);

    Task<bool> SetSteamAccountCountry(SteamLoginState loginState, string currencyCode);

    Task<List<CurrencyData>?> GetSteamAccountCountryCodes(SteamLoginState loginState);

    Task<string?> GetApiKey(SteamLoginState steamLoginState);

    Task<string?> RegisterApiKey(SteamLoginState steamLoginState, string? domain = null);

    Task<InventoryPageResponse> GetInventories(ulong steamId, string appId, string contextId, int count = 100, string? startAssetId = null, string language = "schinese");

    Task<InventoryTradeHistoryRenderPageResponse> GetInventoryTradeHistory(SteamLoginState loginState, int[]? appFilter = null, InventoryTradeHistoryRenderPageResponse.InventoryTradeHistoryCursor? cursor = null);

    IAsyncEnumerable<InventoryTradeHistoryRow> ParseInventoryTradeHistory(string html, CultureInfo? cultureInfo = null);

    Task<IEnumerable<SendGiftHisotryItem>> GetSendGiftHisotries(SteamLoginState loginState);

    IAsyncEnumerable<LoginHistoryItem>? GetLoginHistory(SteamLoginState loginState);

    Task<bool> CheckAccessTokenValidation(string accesstoken);

    /// <summary>
    /// 检查账号是否绑定了手机号
    /// </summary>
    Task<bool?> CheckAccountPhoneStatus(string accessToken);

    Task<string?> GetAccessToken(
            string sessionId,
            string steamLoginSecure,
            string timezoneOffset);

    Task<string?> RefreshAccessToken(ulong steamId, string refreshToken);

    bool IsAccessTokenValid(string accessToken);
}