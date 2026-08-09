const migration = {
  version: 2,
  description: 'Rename granular categories to 13 universal semantic categories',
  sql: `
    UPDATE events SET category = 'shipping'        WHERE category IN ('code_commit','code_push','code_merge');
    UPDATE events SET category = 'versioning'      WHERE category IN ('code_pull','branch_switch','code_stash','git_other');
    UPDATE events SET category = 'building'        WHERE category = 'build';
    UPDATE events SET category = 'running'         WHERE category IN ('server_run','script_run');
    UPDATE events SET category = 'testing'         WHERE category = 'test_run';
    UPDATE events SET category = 'linting'         WHERE category = 'lint_run';
    UPDATE events SET category = 'dependencies'    WHERE category IN ('dependency_install','dependency_remove');
    UPDATE events SET category = 'infrastructure'  WHERE category = 'infrastructure';
    UPDATE events SET category = 'files'           WHERE category IN ('file_ops','environment');
    UPDATE events SET category = 'exploring'       WHERE category IN ('code_search','code_read');
  `,
}

export default migration
