document.getElementById('percentageForm').addEventListener("submit",
    function (event) {
        event.preventDefault();
        
        var xValue = document.getElementById('x-input').value;
        var yValue = document.getElementById('y-input').value;
        var result = document.getElementById('result');

        if(xValue && yValue){
            result.innerText = "Result : " +  (xValue / yValue) * 100 + "%";
        }
        else{
            result.innerText = "Fill All Fields" ;
        }
    }
);
//<input type="submit" id="calculate-button" name="calculate-button" value="Tell Me">