import pytest

from kbcli.vault import Vault


@pytest.fixture
def vault(tmp_path):
    root = tmp_path / "知识库"
    Vault.initialize(root)
    return Vault(root, tmp_path / "state")
