"""A placeholder that is the only thing on its line takes the line with it
when it renders empty (emails.render). The conditional blocks
({{school_info_block}}, {{refund_line}}…) carry no line breaks of their own,
so HQ can give them a paragraph or a line in the editor without leaving a
blank line when there is nothing to say — and when there is, the block
renders exactly where the placeholder sits."""
from notifications.emails import render


def test_lone_paragraph_disappears_when_empty():
    assert render("<p>a</p><p>{{x}}</p><p>b</p>", {"x": ""}) == "<p>a</p><p>b</p>"
    assert render("<p>a</p><p>{{x}}</p><p>b</p>", {"x": "X"}) == "<p>a</p><p>X</p><p>b</p>"
    # the editor may decorate the paragraph, and spaces inside the braces are fine
    assert render('<p style="text-align: left">{{ x }}</p>', {"x": ""}) == ""


def test_lone_br_separated_line_disappears_when_empty():
    assert render("<p>a<br>{{x}}<br>b</p>", {"x": ""}) == "<p>a<br>b</p>"
    assert render("<p>a<br>{{x}}</p>", {"x": ""}) == "<p>a</p>"
    assert render("<p>{{x}}<br>b</p>", {"x": ""}) == "<p>b</p>"
    assert render("<p>a<br/>{{x}}<br/>b</p>", {"x": ""}) == "<p>a<br/>b</p>"
    assert render("<p>a<br>{{x}}<br>b</p>", {"x": "X"}) == "<p>a<br>X<br>b</p>"


def test_two_empty_lines_in_a_row_both_disappear():
    assert render("<p>a<br>{{x}}<br>{{y}}<br>b</p>", {"x": "", "y": ""}) == "<p>a<br>b</p>"
    assert render("<p>{{x}}<br>{{y}}<br>b</p>", {"x": "", "y": ""}) == "<p>b</p>"
    assert render("<p>a</p><p>{{x}}</p><p>{{y}}</p><p>b</p>", {"x": "", "y": "Y"}) == "<p>a</p><p>Y</p><p>b</p>"


def test_lone_plain_text_line_disappears_when_empty():
    assert render("a\n{{x}}\nb", {"x": ""}) == "a\nb"
    assert render("a\n{{x}}", {"x": ""}) == "a\n"
    assert render("a\n{{x}}\nb", {"x": "X"}) == "a\nX\nb"


def test_inline_placeholder_just_renders_empty():
    """Only a placeholder that owns its whole line is special."""
    assert render("<p>a {{x}} b</p>", {"x": ""}) == "<p>a  b</p>"
    assert render("<p>a<br>📍 {{x}}<br>b</p>", {"x": ""}) == "<p>a<br>📍 <br>b</p>"
    assert render("Ciao {{x}}", {"x": ""}) == "Ciao "
    assert render("Ciao {{x}}", {}) == "Ciao "
