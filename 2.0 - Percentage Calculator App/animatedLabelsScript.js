document.addEventListener('DOMContentLoaded', function() {
    const inputs = document.querySelectorAll('input');
  
    inputs.forEach(input => {
      input.addEventListener('focus', () => {
        input.parentNode.querySelector('label').classList.add('active');
      });
  
      input.addEventListener('blur', () => {
        if (input.value === '') {
          input.parentNode.querySelector('label').classList.remove('active');
        }
      });
    });
  });