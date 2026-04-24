from gloss.protect import protect, restore


def test_protect_citation():
    pt = protect("As shown in [12], the result holds.")
    assert "[12]" not in pt.text
    assert "⟦" in pt.text
    restored = restore(pt.text, pt.tokens)
    assert restored == "As shown in [12], the result holds."


def test_protect_url():
    src = "See https://example.com/foo?q=bar for details."
    pt = protect(src)
    assert "https://" not in pt.text
    assert restore(pt.text, pt.tokens) == src


def test_protect_multiple_kinds():
    src = (
        "Fig. 3 shows the result [1, 2]. "
        "See https://example.org and contact foo@bar.com. "
        "Refer to §2.1 and Eq. 5."
    )
    pt = protect(src)
    # Fig. 3 / [1,2] / URL / email / §2.1 / Eq. 5 = 6 distinct items
    assert pt.text.count("⟦") == 6
    restored = restore(pt.text, pt.tokens)
    assert restored == src


def test_restore_is_stable_after_translation():
    # Simulate a translator that keeps tokens but wraps text in JA
    src = "See [1] and Fig. 2 for baseline."
    pt = protect(src)
    translated = f"[JA] {pt.text}"
    restored = restore(translated, pt.tokens)
    assert "[1]" in restored
    assert "Fig. 2" in restored
    assert restored.startswith("[JA] ")


def test_restore_handles_missing_placeholder():
    # If translator accidentally drops a token, the rest should still restore
    pt = protect("Text [1] more [2] end.")
    # Simulate only first token surviving
    corrupted = pt.text.replace("⟦1⟧", "")
    restored = restore(corrupted, pt.tokens)
    assert "[1]" in restored
    assert "[2]" not in restored
