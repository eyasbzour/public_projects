"""Pure-logic checks (no Tesseract, LibreOffice or network). Run from server/:  python -m pytest tests -q"""
import pytest

import convert
from engines.ai_engines import parse_claude_json
from engines.common import EngineError, Line, Word, lines_to_blocks, low_note, words_to_segs


def test_low_confidence_run_becomes_one_flag():
    segs = words_to_segs([Word("a", 90), Word("b", 30), Word("c", 20), Word("d", 90)], 65)
    assert segs == [{"s": "a "}, {"s": "b c", "note": low_note(20)}, {"s": " "}, {"s": "d"}]
    # with the image size, the flag remembers where it is on the page
    boxed = words_to_segs([Word("b", 30, (100, 50, 200, 80)), Word("c", 20, (210, 52, 300, 82))], 65, (1000, 500))
    assert boxed[0]["box"] == [0.1, 0.1, 0.3, 0.164]


def test_lines_group_into_heading_paragraph_bullet():
    lines = [
        Line([Word("عنوان", 95)], 400, 0, 600, 20),                     # short, narrow -> heading
        Line([Word("نص", 95), Word("أول", 95)], 0, 60, 1000, 80),       # big gap -> new paragraph
        Line([Word("تكملة", 95)], 0, 85, 1000, 105),                     # small gap -> same paragraph
        Line([Word("•", 95), Word("بند", 95)], 0, 150, 1000, 170),       # bullet
        Line([Word("المدير", 95)], 0, 230, 200, 250),                     # short, far (left) side -> signature
    ]
    assert lines_to_blocks(lines, 65) == [
        {"type": "h", "bold": True, "segs": [{"s": "عنوان"}], "align": "center"},
        {"type": "p", "bold": False, "segs": [{"s": "نص أول تكملة"}]},
        {"type": "li", "bold": False, "segs": [{"s": "بند"}]},
        {"type": "p", "bold": False, "segs": [{"s": "المدير"}], "align": "end"},
    ]


def test_paragraph_lines_keep_their_place_and_where_their_text_starts():
    lines = [Line([Word("نص", 95), Word("أول", 95)], 0, 60, 1000, 80),
             Line([Word("تكملة", 95)], 600, 85, 1000, 105)]
    [b] = lines_to_blocks(lines, 65, (), (1000, 500))
    assert b["lines"] == [[0, 0.12, 1, 0.16, 0], [0.6, 0.17, 1, 0.21, 7]]
    assert "".join(s["s"] for s in b["segs"])[b["lines"][1][4]:] == "تكملة"


def test_ruled_table_found_and_words_go_into_cells():
    from PIL import Image, ImageDraw
    from engines.tables import find_tables

    img = Image.new("RGB", (1240, 1754), "white")
    d = ImageDraw.Draw(img)
    xs, ys = [200, 500, 800, 1100], [600, 680, 760]  # 3 columns x 2 rows
    for y in ys:
        d.line([(xs[0], y), (xs[-1], y)], fill="black", width=3)
    for x in xs:
        d.line([(x, ys[0]), (x, ys[-1])], fill="black", width=3)
    d.line([(200, 300), (1100, 300)], fill="black", width=3)  # an underline is not a table
    grids, unruled = find_tables(img)
    assert len(grids) == 1
    # Tesseract's copy has the table's lines painted white; the lone underline (not a table) stays
    assert unruled.getpixel((650, 600)) == (255, 255, 255) and unruled.getpixel((500, 640)) == (255, 255, 255)
    assert unruled.getpixel((650, 300)) == (0, 0, 0)
    g = grids[0]
    assert [round(v) for v in g.xs] == pytest.approx(xs, abs=4) and [round(v) for v in g.ys] == pytest.approx(ys, abs=4)

    word = lambda t, x: Word(t, 95, (x - 40, 620, x + 40, 660))  # noqa: E731 (row 1)
    table_line = Line([word("أ", 950), word("ب", 650), word("ج", 350)], 310, 620, 990, 660)
    text_line = Line([Word("نص", 95, (900, 400, 1000, 440))], 900, 400, 1000, 440)
    blocks = lines_to_blocks([text_line, table_line], 65, grids)
    assert blocks[0]["segs"] == [{"s": "نص"}]
    assert blocks[1]["type"] == "table" and "borderless" not in blocks[1]
    # columns count from the right, as the page reads
    assert blocks[1]["rows"] == [[[{"s": "أ"}], [{"s": "ب"}], [{"s": "ج"}]], [[], [], []]]
    # with the page size each cell knows its place: the first cell is the rightmost column of the first row
    sized = lines_to_blocks([Line([word("أ", 950), word("ب", 650), word("ج", 350)], 310, 620, 990, 660)], 65, grids, img.size)
    first, last = sized[0]["cellBoxes"][0][0], sized[0]["cellBoxes"][1][2]
    assert first[0] * 1240 == pytest.approx(800, abs=5) and first[2] * 1240 == pytest.approx(1100, abs=5) and first[1] * 1754 == pytest.approx(600, abs=5)
    assert last[0] * 1240 == pytest.approx(200, abs=5) and last[3] * 1754 == pytest.approx(760, abs=5)


def test_wide_gap_keeps_both_ends_of_a_row():
    w = lambda t, x0, x1: Word(t, 95, (x0, 100, x1, 130))  # noqa: E731
    row = Line([w("الرقم:", 1000, 1100), w("245", 920, 980), w("التاريخ:", 300, 400), w("10/11/2026", 150, 280)], 150, 100, 1100, 130)
    body = Line([w("نص", 150, 1100)], 150, 170, 1100, 200)
    blocks = lines_to_blocks([row, body], 65)
    assert blocks[0] == {"type": "table", "bold": False, "borderless": True,
                         "rows": [[[{"s": "الرقم: 245"}], [{"s": "التاريخ: 10/11/2026"}]]]}
    assert blocks[1]["type"] == "p"


def test_lineless_table_from_column_gaps_that_line_up():
    def row(y, cells):  # cells right to left: (text, x0, x1)
        return Line([Word(t, 95, (x0, y, x1, y + 30)) for t, x0, x1 in cells], min(c[1] for c in cells), y,
                    max(c[2] for c in cells), y + 30)
    lines = [row(100, [("اليوم", 900, 1000), ("الساعة", 700, 780), ("المكان", 200, 300)]),
             row(150, [("الأحد", 910, 1000), ("9:00", 720, 780), ("قاعة", 220, 300)]),
             row(200, [("الثلاثاء", 880, 1000), ("11:30", 705, 780), ("مكتب", 180, 300)]),
             row(260, [("نص بعد الجدول بلا فراغات", 180, 1000)])]
    blocks = lines_to_blocks(lines, 65)
    assert blocks[0]["type"] == "table" and blocks[0]["lineless"] and blocks[0]["borderless"]
    assert [[c[0]["s"] for c in r] for r in blocks[0]["rows"]] == [
        ["اليوم", "الساعة", "المكان"], ["الأحد", "9:00", "قاعة"], ["الثلاثاء", "11:30", "مكتب"]]
    assert blocks[1]["type"] == "p"
    # each cell's place: between the column gaps, on its row
    boxes = lines_to_blocks(lines, 65, (), (1000, 500))[0]["cellBoxes"]
    assert len(boxes) == 3 and all(len(r) == 3 for r in boxes)
    right, mid = boxes[1][0], boxes[1][1]
    assert right[0] * 1000 < 900 and right[2] * 1000 >= 1000 and mid[0] * 1000 < 705 and 780 < mid[2] * 1000 < 880
    assert right[1] == 0.3 and right[3] == 0.36


def test_claude_reply_markers_table_and_notes():
    raw = ('Here you go:\n```json\n{"blocks":['
           '{"type":"heading","text":"الموضوع"},'
           '{"type":"paragraph","text":"قرأنا [[الكتاب||غير واضح]] المرفق"},'
           '{"type":"table","rows":[["أ","ب"],["1","2"]]}],'
           '"notes":[{"anchor":"المرفق","note":"ختم"},{"anchor":"غير موجود","note":"توقيع"}]}\n```')
    head, para, table = parse_claude_json(raw)
    # anchor not found -> note goes on the first text, marked as approximate
    assert head == {"type": "h", "bold": True, "segs": [{"s": "الموضوع", "note": "(موضع الملاحظة تقريبي) توقيع"}]}
    assert para["segs"] == [{"s": "قرأنا "}, {"s": "الكتاب", "note": "غير واضح"},
                            {"s": " "}, {"s": "المرفق", "note": "ختم"}]
    assert table["rows"] == [[[{"s": "أ"}], [{"s": "ب"}]], [[{"s": "1"}], [{"s": "2"}]]]


def test_claude_reply_without_json_is_a_user_error():
    with pytest.raises(EngineError):
        parse_claude_json("sorry, I cannot read this page")


def test_convert_docx_passthrough_sanitizes_name():
    data, name, mime = convert.convert(b"PK-docx", "docx", 'a/b:c*?"<>|d')
    assert (data, name) == (b"PK-docx", "abcd.docx") and "wordprocessingml" in mime
    with pytest.raises(convert.ConvertError):
        convert.convert(b"PK", "exe", "x")


def test_handwriting_signature_and_stamp_leave_the_text_as_notes():
    from PIL import Image, ImageDraw
    from engines.marks import split_marks

    img = Image.new("RGB", (1240, 1754), (250, 250, 248))
    d = ImageDraw.Draw(img)
    d.rectangle((600, 100, 1100, 140), fill=(30, 30, 30))                      # printed line (black)
    d.rectangle((300, 200, 1100, 240), fill=(255, 240, 80))                    # yellow highlight...
    d.rectangle((320, 205, 1080, 235), fill=(25, 25, 20))                      # ...with black print on it
    d.line([(150, 120), (450, 150)], fill=(20, 60, 180), width=6)               # blue handwriting read as a word
    d.line([(200, 1400), (420, 1450), (520, 1380)], fill=(20, 50, 170), width=5)  # blue signature nobody read
    d.ellipse((800, 1300, 1000, 1500), outline=(110, 60, 160), width=8)         # purple stamp

    w = lambda t, b, c=95: Word(t, c, b)  # noqa: E731
    lines = [Line([w("سطر", (600, 100, 1100, 140)), w("خربشة", (150, 110, 450, 160), 40)], 150, 100, 1100, 160),
             Line([w("مظلل", (320, 205, 1080, 235))], 320, 205, 1080, 235)]
    kept, marks = split_marks(lines, img, img.size, 65)
    assert [x.text for ln in kept for x in ln.words] == ["سطر", "مظلل"]       # print stays, highlighted print too
    kinds = sorted(m["kind"] for m in marks)
    assert kinds == ["hand", "sign", "stamp"], marks
    hand = next(m for m in marks if m["kind"] == "hand")
    assert hand["text"] == "خربشة" and hand["label"] == "[تأشيرة بخط اليد]" and "«خربشة»" in hand["note"]
    # back in the page as flagged placeholders, after the block above them
    blocks = lines_to_blocks(kept, 65, (), img.size, marks)
    assert [b["segs"][0]["s"] for b in blocks][-2:] == ["[ختم]", "[توقيع]"] or [b["segs"][0]["s"] for b in blocks][-2:] == ["[توقيع]", "[ختم]"]
    assert all("box" in b["segs"][0] for b in blocks if b["segs"][0]["s"].startswith("["))


def test_numbers_paddle_dropped_come_from_tesseract_flagged():
    from engines.numbers import NOTE, check_numbers
    w = lambda t, b, c=95: Word(t, c, b)  # noqa: E731
    paddle = [Line([w("الرقم", (900, 100, 1000, 130)), w("م", (860, 100, 890, 130)), w("ض4/", (700, 100, 850, 130))], 700, 100, 1000, 130),
              Line([w("نص", (800, 200, 1000, 230))], 800, 200, 1000, 230)]
    # Tesseract read an image twice as large
    tess = [Line([w("الرقم:", (1800, 200, 2000, 260)), w("م", (1720, 200, 1780, 260)), w("ض", (1680, 200, 1710, 260)),
                  w("245", (1560, 200, 1660, 260)), w("2026", (1400, 200, 1540, 260))], 1400, 200, 2000, 260)]
    out = check_numbers(paddle, tess, 2.0)
    assert [x.text for x in out[0].words] == ["الرقم:", "م", "ض", "245", "2026"]
    assert [x.note for x in out[0].words][-2:] == [NOTE, NOTE] and out[1] is paddle[1]
    segs = words_to_segs(out[0].words, 65)
    assert [s.get("note") for s in segs if s.get("note")] == [NOTE, NOTE]


def test_list_items_from_bullets_numbers_and_a_skipped_bullet():
    from PIL import Image, ImageDraw
    from engines.lists import mark_list_items

    img = Image.new("RGB", (1240, 800), "white")
    d = ImageDraw.Draw(img)
    for y in (100, 160):                       # two printed bullets the reader skipped, right of the text
        d.ellipse((1085, y + 15, 1095, y + 25), fill="black")
        d.rectangle((600, y + 5, 1065, y + 35), fill="black")   # the item's text
    d.rectangle((300, 300, 1125, 340), fill="black")             # a plain line at the margin, no bullet
    w = lambda t, x0, x1, y: Word(t, 95, (x0, y, x1, y + 40))  # noqa: E731
    lines = [Line([w("بند", 600, 1065, 100)], 600, 100, 1097, 140),
             Line([w("بند", 600, 1065, 160)], 600, 160, 1097, 200),
             Line([w("نص", 300, 1125, 300)], 300, 300, 1125, 340),
             Line([w("1.", 1060, 1100, 400), w("أول", 700, 1050, 400)], 700, 400, 1100, 440),
             Line([w("2-", 1060, 1100, 450), w("ثان", 700, 1050, 450)], 700, 450, 1100, 490),
             Line([w("•", 1080, 1100, 520), w("نقطة", 700, 1050, 520)], 700, 520, 1100, 560)]
    lines = mark_list_items(lines, img)
    assert [ln.extra.get("list") for ln in lines] == ["li", "li", None, "ol", "ol", "li"]
    assert [w.text for w in lines[3].words] == ["أول"] and lines[3].extra["num"] == 1
    kinds = [b["type"] for b in lines_to_blocks(lines, 65)]
    assert kinds == ["li", "li", "p", "ol", "ol", "li"], kinds


def test_dark_screenshot_of_json_reads_as_code_without_marks():
    import io
    from PIL import Image, ImageDraw
    from engines.common import load_image
    from engines.direction import arabic_runs_rtl
    from engines.marks import split_marks

    def png(img):
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()

    # light text on a dark screen, a red spellcheck squiggle under one word
    shot = Image.new("RGB", (300, 150), (43, 43, 43))
    d = ImageDraw.Draw(shot)
    rows = ['{', '  "taxpayer": "100000009",', '  "hasIssues": true,', '  "details": [', '  ]', '}']
    for k, t in enumerate(rows):
        d.text((40, 40 + 18 * k), t, fill=(220, 220, 220))
    d.line([(60 + 4 * i, 70 + (i % 2) * 3) for i in range(20)], fill=(230, 50, 50), width=1)
    img = load_image(png(shot), 0, "none")
    assert min(img.getpixel((5, 5))) > 200                      # the screen is light now...
    r, g, _ = img.getpixel((60, 70))
    assert r > g + 80                                           # ...and the red squiggle still red
    lines = [Line([Word(t.strip(), 95, (40, 40 + 18 * k, 40 + 6 * len(t), 51 + 18 * k))], 40, 40 + 18 * k, 40 + 6 * len(t), 51 + 18 * k)
             for k, t in enumerate(rows)]
    kept, marks = split_marks(lines, img, img.size, 65)
    assert marks == [] and len(kept) == len(rows)               # a squiggle is not handwriting

    # a white sheet photographed on a dark table stays as it is
    photo = Image.new("RGB", (600, 800), (40, 40, 40))
    ImageDraw.Draw(photo).rectangle((100, 100, 500, 700), fill=(240, 240, 235))
    assert load_image(png(photo), 0, "none").getpixel((5, 5)) == (40, 40, 40)

    # code lines (here as the layout sees an English page: mirrored, so a line starts at its x1) keep their
    # breaks and indents, in one block; the heading just above, closer than 3/4 of a line, is its own block
    code = ['{', '"a": 1,', '"b": [', '2', ']', '}']
    indent = [0, 2, 2, 4, 2, 0]
    w = lambda t, x0, x1, y: Word(t, 95, (x0, y, x1, y + 20))  # noqa: E731
    lines = [Line([w("Sample", 860, 920, 0), w("response", 930, 1000, 0)], 860, 0, 1000, 20)]
    for k, (t, i) in enumerate(zip(code, indent)):
        x1, y = 1000 - 10 * i, 27 + 14 * k
        lines.append(Line([w(t, x1 - 10 * len(t), x1, y)], x1 - 10 * len(t), y, x1, y + 20))
    blocks = lines_to_blocks(lines, 65, (), (1000, 200))
    assert len(blocks) == 2 and "".join(sg["s"] for sg in blocks[0]["segs"]) == "Sample response"
    text = "".join(sg["s"] for sg in blocks[1]["segs"])
    assert text == '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}'
    assert blocks[1]["lines"][1][4] == text.index("\n") + 1    # a line starts where its indent does

    # Arabic words on an English line, placed left to right, read right to left
    words = [Word(t, 90, (x, 0, x + 10, 10)) for t, x in [('"21":', 0), ('عنها"', 20), ('يصرح', 40), ('517', 60), ('"ثلاثة', 80), ("}", 100)]]
    assert " ".join(x.text for x in arabic_runs_rtl(words)) == '"21": "ثلاثة 517 يصرح عنها" }'
