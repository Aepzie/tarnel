package org.velabrowser.vela.adblock

/** Counts describing what an [AdblockEngine] loaded and what it skipped. */
data class EngineStats(
    /** Network blocking filters (excluding exceptions), including `$important` ones and hosts entries. */
    val blockFilters: Int,
    /** Network exception filters (`@@...`). */
    val exceptionFilters: Int,
    /** Subset of [blockFilters] carrying `$important`. */
    val importantFilters: Int,
    /** Regex network filters (`/.../`), block + exception. */
    val regexFilters: Int,
    /** Generic element-hiding rules (`##.ad`, also `~site.com##.ad`). */
    val genericCosmeticFilters: Int,
    /** Domain-scoped element-hiding rules (`example.com##.ad`). */
    val specificCosmeticFilters: Int,
    /** Element-hiding exceptions (`#@#`). */
    val cosmeticExceptions: Int,
    /** Filters removed by a matching `$badfilter` (plus the `$badfilter` rules themselves). */
    val badFiltered: Int,
    /** Duplicate rules dropped while compiling (e.g. the same host in two lists). */
    val duplicates: Int,
    /** Scriptlet / snippet injection rules (`##+js(...)`, `#$#`, `#%#`) — not supported. */
    val unsupportedScriptlets: Int,
    /** Procedural / extended cosmetic rules (`:has-text`, `:-abp-has`, `#?#`, `##^` HTML filters, ...) — not supported. */
    val unsupportedProcedural: Int,
    /** `$redirect`, `$redirect-rule`, `$removeparam`, `$rewrite`, ... — not supported. */
    val unsupportedRedirects: Int,
    /** Anything else not supported: unknown options, `$csp`, `$popup`, invalid or oversized regexes, ... */
    val unsupportedOther: Int,
) {
    val networkFilters: Int get() = blockFilters + exceptionFilters
    val cosmeticFilters: Int get() = genericCosmeticFilters + specificCosmeticFilters + cosmeticExceptions
    val unsupported: Int get() = unsupportedScriptlets + unsupportedProcedural + unsupportedRedirects + unsupportedOther
}
